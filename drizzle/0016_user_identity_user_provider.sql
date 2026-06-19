-- Covers (user_id, provider) lookups in identity.service / channel-identity.service
-- (Google credential read, channel-key filters). Prefix-covers (user_id, kind, provider).
CREATE INDEX IF NOT EXISTS `idx_user_identity_user_provider` ON `user_identities` (`user_id`,`provider`);
