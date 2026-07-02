-- Runs once when the Postgres container's data volume is first created.
-- POSTGRES_DB already created tt_control; add the app DB + the RLS role here.
CREATE DATABASE tt_app;
CREATE ROLE tt_app_rw LOGIN PASSWORD 'tt_app_rw';
