export default function ContentSkeleton({ compact=false }){
 return <div className={`content-skeleton ${compact?'compact':''}`} role="status" aria-label="Loading content"><span className="sr-only">Loading content…</span>{[0,1,2].map(index=><div key={index} className="skeleton-card" aria-hidden="true"><div className="skeleton-person"><i/><div><b/><b/></div></div>{!compact&&<><div className="skeleton-line"/><div className="skeleton-line short"/><div className="skeleton-photo"/></>}</div>)}</div>;
}
