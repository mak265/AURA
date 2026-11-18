// Used only after the post's audience and author visibility checks are applied.
const showRealProfile = `p.identity_mode='profile' AND NULLIF(BTRIM(u.real_name), '') IS NOT NULL`;
const displayName = `CASE WHEN ${showRealProfile} THEN BTRIM(u.real_name)
  ELSE COALESCE(NULLIF(BTRIM(a.aura_name), ''), 'Aura') END`;
const postIdentityFields = `p.identity_mode, ${displayName} AS aura_name, ${displayName} AS author_name,
  CASE WHEN ${showRealProfile} THEN u.profile_photo END AS profile_photo`;

module.exports = { postIdentityFields };
