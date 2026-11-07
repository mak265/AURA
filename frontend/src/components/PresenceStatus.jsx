function elapsedLabel(value) {
  const minutes=Math.max(1,Math.floor((Date.now()-new Date(value).getTime())/60000));
  if(minutes<60)return `Active ${minutes}m ago`;
  if(minutes<1440)return `Active ${Math.floor(minutes/60)}h ago`;
  return `Active ${Math.floor(minutes/1440)}d ago`;
}
export default function PresenceStatus({ presence, compact=false }) {
  if(presence?.active_now===null)return null;
  if(presence?.active_now===undefined)return null;
  return <span className={`presence-status ${presence.active_now?'is-online':''}`}><span className="presence-dot"/>{presence.active_now?'Active now':presence.last_active_at?elapsedLabel(presence.last_active_at):compact?'Offline':'Not active right now'}</span>;
}
