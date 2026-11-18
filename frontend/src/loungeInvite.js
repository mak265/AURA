export function loungeInvitePath(roomId) {
  return `/aura-lounge?room=${roomId}`;
}

export function isLoungeInvite(value) {
  return typeof value === 'string' && /^\/aura-lounge\?room=[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}
