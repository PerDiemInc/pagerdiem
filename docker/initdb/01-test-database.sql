-- A separate database for `npm run test:pg`, which wipes it. Never point tests at the app's database.
CREATE DATABASE pagerdiem_test;
