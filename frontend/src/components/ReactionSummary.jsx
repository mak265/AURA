import ReactionIcon from './ReactionIcon';
export default function ReactionSummary({ counts = {}, total = 0, onClick, expanded }) {
  if (!Number(total)) return null;
  const types=Object.entries(counts).filter(([,count])=>Number(count)>0).sort((a,b)=>Number(b[1])-Number(a[1])).slice(0,3);
  return <button type="button" className="post-reaction-summary" onClick={onClick} aria-label={`${total} reactions. View post reactions`} aria-expanded={expanded}>
    <span className="post-reaction-stack">{types.map(([type])=><span key={type}><ReactionIcon type={type} size={22}/></span>)}</span><span>{total}</span>
  </button>;
}
