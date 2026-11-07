function parseAttachment(kind, data, duration) {
  if (!['image','audio'].includes(kind) || typeof data!=='string' || data.length>14000000) throw new Error('Choose a valid image or voice message.');
  const match=/^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
  if (!match) throw new Error('Invalid attachment format.');
  const mime=match[1],bytes=Buffer.from(match[2],'base64');
  const imageTypes=['image/jpeg','image/png','image/webp'];
  const audioTypes=['audio/webm','audio/ogg','audio/mp4'];
  if (!(kind==='image'?imageTypes:audioTypes).includes(mime) || !bytes.length || bytes.length>(kind==='image'?5:10)*1024*1024) throw new Error('Attachment is unsupported or too large.');
  const valid=mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216:
    mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):
    mime==='image/webp'?bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP':
    mime==='audio/webm'?bytes.subarray(0,4).equals(Buffer.from([26,69,223,163])):
    mime==='audio/ogg'?bytes.toString('ascii',0,4)==='OggS':bytes.toString('ascii',4,8)==='ftyp';
  if (!valid) throw new Error('Attachment contents do not match the file type.');
  if (kind==='audio' && (typeof duration!=='number'||!Number.isFinite(duration)||duration<=0||duration>120)) throw new Error('Voice messages can be up to two minutes.');
  return {bytes,mime,duration:kind==='audio'?duration:null};
}
module.exports={parseAttachment};
