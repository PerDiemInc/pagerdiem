Optional extra CA certificates baked into the Docker image (see the Dockerfile).

For Amazon RDS, download the RDS bundle here before building, then set
`NODE_EXTRA_CA_CERTS=/app/certs/rds-global-bundle.pem` in the container:

    curl -o certs/rds-global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem
