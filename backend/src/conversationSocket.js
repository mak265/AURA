const db=require('./db');
function channel(input) {
  if (!input || !['match','aura'].includes(input.kind)) return null;
  const id=Number(input.id);
  return Number.isSafeInteger(id)&&id>0 ? {kind:input.kind,id,room:`${input.kind}:${id}`} : null;
}
async function authorizeChannel(socket,scope,typing=true) {
  const table=scope.kind==='match'?'matches':'aura_sessions';
  const eligibility=scope.kind==='match'?(typing?'c.soul_game_completed=TRUE':'TRUE'):"c.status='active' AND c.mode='chat' AND c.created_at>NOW()-INTERVAL '5 minutes'";
  const result=await db.query(`SELECT c.id FROM ${table} c
    JOIN users u ON u.id=$2 JOIN users a ON a.id=c.user1_id JOIN users b ON b.id=c.user2_id
    WHERE c.id=$1 AND (c.user1_id=$2 OR c.user2_id=$2) AND ${eligibility}
    AND u.auth_version=$3 AND a.banned_at IS NULL AND b.banned_at IS NULL
    AND NOT EXISTS(SELECT 1 FROM blocks WHERE (blocker_id=c.user1_id AND blocked_id=c.user2_id) OR (blocker_id=c.user2_id AND blocked_id=c.user1_id))`,[scope.id,socket.userId,socket.authVersion||0]);
  return result.rowCount>0;
}
function registerConversationSocket(socket) {
  let lastTyping=0,sequence=0;
  const join=kind=>async(input,ack)=>{
    const scope=channel({kind,id:kind==='match'?(input?.matchId??input):input?.sessionId});
    try {
      if(!scope||!await authorizeChannel(socket,scope,false)||socket.connected===false){if(typeof ack==='function')ack({ok:false});return;}
      await socket.join(scope.room);
      if(typeof ack==='function')ack({ok:true});
    }catch{if(typeof ack==='function')ack({ok:false});}
  };
  socket.on('join:match',join('match'));
  socket.on('join:aura',join('aura'));
  socket.on('typing',async input=>{
    const scope=channel(input);
    if(!scope||typeof input.typing!=='boolean'||!socket.rooms.has(scope.room))return;
    if(input.typing&&Date.now()-lastTyping<700)return;
    if(input.typing)lastTyping=Date.now();
    const current=++sequence;
    try{
      if(!await authorizeChannel(socket,scope)||current!==sequence||socket.connected===false)return;
      socket.to(scope.room).emit('typing',{kind:scope.kind,id:scope.id,userId:socket.userId,typing:input.typing});
    }catch{/* Typing is ephemeral; clients expire it even if connectivity fails. */}
  });
  socket.on('disconnecting',()=>{
    sequence++;
    for(const room of socket.rooms){const match=/^(match|aura):(\d+)$/.exec(room);if(match)socket.to(room).emit('typing',{kind:match[1],id:Number(match[2]),userId:socket.userId,typing:false});}
  });
}
module.exports={channel,authorizeChannel,registerConversationSocket};
