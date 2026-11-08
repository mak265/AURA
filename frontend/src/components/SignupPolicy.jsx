import {useEffect,useState} from 'react';
import api from '../api/client';
export default function SignupPolicy({onContinue,readOnly=false}) {
 const [policy,setPolicy]=useState(null),[error,setError]=useState(''),[checks,setChecks]=useState({terms:false,privacy:false,adult:false});
 const load=()=>{setError('');api.get('/auth/policies').then(r=>setPolicy(r.data)).catch(()=>setError('Unable to load policies. Please retry.'));};
 useEffect(()=>{load();},[]);
 return <section className="signup-policy"><small>A LITTLE TRUST GOES A LONG WAY</small><h1 className="auth-title">Before we begin</h1><p>Real connections start with respect. Learn how AURA works and how we handle your information.</p>
 {error&&<p role="alert">{error} <button onClick={load}>Retry</button></p>}{!policy&&!error&&<p role="status">Loading policies…</p>}
 {policy&&<><p className="policy-version">Version {policy.version} · Development draft</p><div className="policy-documents">{policy.documents.map(doc=><details key={doc.title}><summary>{doc.title}</summary>{doc.sections.map(([title,text])=><section key={title}><h3>{title}</h3><p>{text}</p></section>)}</details>)}</div>
 {!readOnly&&<><fieldset className="policy-checks"><legend>Your choice to join</legend>{[['terms','I agree to the Terms of Use and Community Guidelines.'],['privacy','I acknowledge the Privacy Notice, including report evidence retention.'],['adult','I confirm that I am at least 18 years old.']].map(([key,label])=><label key={key}><input type="checkbox" checked={checks[key]} onChange={e=>setChecks({...checks,[key]:e.target.checked})}/><span>{label}</span></label>)}</fieldset><button className="aura-btn-primary w-full" disabled={!Object.values(checks).every(Boolean)} onClick={()=>onContinue({version:policy.version,...checks})}>Agree & continue</button><p className="policy-version">You can leave without creating an account.</p></> }</> }</section>;
}
