# Deploy on AWS (ECS Fargate + RDS)

An always-on setup: one Fargate task behind an Application Load Balancer, Postgres on RDS,
secrets in Secrets Manager, logs in CloudWatch. Allow about an hour.

```
Slack / browsers ──HTTPS──▶ ALB (ACM certificate) ──▶ ECS Fargate task (1) ──▶ RDS Postgres
                                                          │
                                                          └── Secrets Manager, CloudWatch Logs
```

**Rough cost** (us-east-1, on-demand, check current pricing): ALB ≈ $16–20, Fargate 0.25 vCPU / 0.5 GB
on ARM ≈ $7–9, RDS `db.t4g.micro` + 20 GB ≈ $13–15. About **$35–45/month** in total.
If you already run an ALB or a Postgres instance, reuse them and it costs much less.

**Run exactly one task.** Reminders and escalation run on a timer inside the web process;
two tasks would double-send.

The commands below use the AWS CLI v2 and Docker. Replace `REGION`, `ACCOUNT_ID` and the
`example.com` names with yours.

```bash
export AWS_REGION=REGION ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
```

## 1. Database: RDS Postgres

Create the instance in the console (RDS → **Create database**), or with the CLI:

```bash
aws rds create-db-instance \
  --db-instance-identifier pagerdiem \
  --engine postgres --engine-version 16 \
  --db-instance-class db.t4g.micro --allocated-storage 20 \
  --master-username pagerdiem --manage-master-user-password \
  --no-publicly-accessible --backup-retention-period 7 \
  --vpc-security-group-ids sg-DATABASE
```

- `sg-DATABASE` should allow inbound **5432 only from the ECS task's security group** (step 4).
- `--manage-master-user-password` stores the password in Secrets Manager. Read it once to
  build the connection string:
  `postgres://pagerdiem:PASSWORD@pagerdiem.xxxx.REGION.rds.amazonaws.com:5432/postgres?sslmode=verify-full`

RDS certificates are signed by Amazon's own CA, which Node doesn't trust by default.
Bundle it into the image (step 2) and keep `sslmode=verify-full`. Don't switch to `no-verify`.

PagerDiem creates its tables on first start.

## 2. Image: ECR

```bash
aws ecr create-repository --repository-name pagerdiem

# Amazon RDS CA bundle, copied into the image by the Dockerfile
curl -o certs/rds-global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem

aws ecr get-login-password | docker login --username AWS --password-stdin $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com
docker buildx build --platform linux/arm64 \
  -t $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/pagerdiem:latest --push .
```

## 3. Secrets: Secrets Manager

Keep every secret in one JSON secret:

```bash
aws secretsmanager create-secret --name pagerdiem/app --secret-string '{
  "DATABASE_URL": "postgres://pagerdiem:PASSWORD@HOST:5432/postgres?sslmode=verify-full",
  "SESSION_SECRET": "'"$(openssl rand -hex 32)"'",
  "API_TOKEN": "'"$(openssl rand -hex 24)"'",
  "GOOGLE_CLIENT_ID": "set-in-step-6",
  "GOOGLE_CLIENT_SECRET": "set-in-step-6",
  "SLACK_BOT_TOKEN": "set-in-step-7",
  "SLACK_SIGNING_SECRET": "set-in-step-7",
  "SLACK_ONCALL_CHANNEL": "set-in-step-7",
  "SLACK_TEAM_ID": "set-in-step-7"
}'
```

Update values later with `aws secretsmanager put-secret-value`, then redeploy (step 8).

## 4. Networking, certificate and load balancer

1. **Certificate:** in ACM, request a public certificate for your hostname (e.g. `oncall.example.com`)
   and validate it with DNS.
2. **Security groups:**
   - `sg-alb`: inbound 443 from anywhere (Slack must reach `/slack/*`, browsers the rest).
   - `sg-task`: inbound 3000 **only from `sg-alb`**.
   - `sg-DATABASE` (step 1): inbound 5432 only from `sg-task`.
3. **Target group:** type **IP**, protocol HTTP, port 3000, health check path `/healthz`.
4. **ALB:** internet-facing, in two public subnets, with an HTTPS :443 listener (your ACM
   certificate) forwarding to the target group. Optionally add an HTTP :80 listener that
   redirects to HTTPS.
5. **DNS:** point `oncall.example.com` at the ALB (Route 53 alias or CNAME).

## 5. ECS: cluster, task definition, service

1. **Execution role** `pagerdiem-execution` with:
   - the managed policy `AmazonECSTaskExecutionRolePolicy`
   - `secretsmanager:GetSecretValue` on `pagerdiem/app` (and on the RDS-managed secret if you reference it)
   - `logs:CreateLogGroup` (the task definition creates its log group)
2. Copy [aws/task-definition.json](aws/task-definition.json). Replace `ACCOUNT_ID`, `REGION`,
   the secret ARN suffix (`-XXXXXX`), `PUBLIC_URL`, `ALLOWED_EMAIL_DOMAINS` and `TEAM_NAME`, then:

   ```bash
   aws ecs create-cluster --cluster-name pagerdiem
   aws ecs register-task-definition --cli-input-json file://docs/aws/task-definition.json
   aws ecs create-service --cluster pagerdiem --service-name pagerdiem \
     --task-definition pagerdiem --desired-count 1 --launch-type FARGATE \
     --deployment-configuration "maximumPercent=100,minimumHealthyPercent=0" \
     --network-configuration "awsvpcConfiguration={subnets=[subnet-A,subnet-B],securityGroups=[sg-task],assignPublicIp=ENABLED}" \
     --load-balancers "targetGroupArn=arn:aws:elasticloadbalancing:...,containerName=pagerdiem,containerPort=3000"
   ```

   - `maximumPercent=100,minimumHealthyPercent=0` makes deploys stop the old task before starting
     the new one, so two schedulers never run at once. You get a short blip of downtime on each deploy.
   - `assignPublicIp=ENABLED` lets the task reach Slack, Google and ECR from public subnets. In
     private subnets, use a NAT gateway (or VPC endpoints) and set it to `DISABLED`.
   - `KEEP_AWAKE` is `false`: Fargate tasks don't sleep.

Open `https://oncall.example.com`. You should see *"Sign-in isn't set up yet."* That's expected
until Google sign-in is configured.

## 6. Google sign-in

Same as the Render guide, using your hostname:

1. Google Cloud Console → new project under your organization → **Google Auth Platform**,
   **Audience: Internal**.
2. **Clients → Create client → Web application**, redirect URI
   `https://oncall.example.com/auth/google/callback`.
3. Put the client ID and secret into `pagerdiem/app` and redeploy (step 8).

## 7. Slack

Follow [Render guide step 5](deploy-render-slack.md#5-slack-app), replacing the manifest URLs with
`https://oncall.example.com`. Store `SLACK_BOT_TOKEN`, `SLACK_SIGNING_SECRET`,
`SLACK_ONCALL_CHANNEL` and `SLACK_TEAM_ID` in `pagerdiem/app`, redeploy, and run
`/invite @PagerDiem` in the on-call channel.

## 8. Deploy updates

```bash
docker buildx build --platform linux/arm64 \
  -t $ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/pagerdiem:latest --push .
aws ecs update-service --cluster pagerdiem --service pagerdiem --force-new-deployment
```

ECS reads secrets when a task starts, so a secret change also needs `--force-new-deployment`.

## Operations

- **Logs:** CloudWatch log group `/ecs/pagerdiem`.
- **Backups:** RDS automated backups (7 days above). Take a manual snapshot before upgrades.
- **Alarms worth adding:** ALB target group `UnHealthyHostCount > 0`, and ECS service `RunningTaskCount < 1`.
  An on-call tool that's down should page someone, so point those alarms at email or a separate channel.
- **Verify:** **Settings** shows Slack connected, **Team → Send me a test message** delivers a DM,
  and `/oncall` works in Slack.
