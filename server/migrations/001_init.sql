-- DebtNav initial schema. Plans hold user inputs only (projections are always recomputed).
-- Money stays as decimal text inside the jsonb document (lossless); dates are ISO calendar strings.
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issuer text NOT NULL,
  subject text NOT NULL,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (issuer, subject)
);

-- Only a SHA-256 hash of each session token is stored; the token itself lives in an httpOnly cookie.
CREATE TABLE sessions (
  id_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

-- One plan per user (v0.2). revision increases by one on every save (optimistic concurrency).
CREATE TABLE plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  schema_version integer NOT NULL,
  document jsonb NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Short-lived OpenID Connect login state (single use, expires after 10 minutes).
CREATE TABLE oidc_flows (
  state text PRIMARY KEY,
  code_verifier text NOT NULL,
  nonce text NOT NULL,
  return_to text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oidc_flows_created_at_idx ON oidc_flows (created_at);
