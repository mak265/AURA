export function BrandMark({ className = '' }) {
  return <img className={`aura-brand-mark ${className}`} src={`${import.meta.env.BASE_URL}aura-mark.png`} alt="" width="40" height="40" />;
}

export default function Brand() {
  return <div className="aura-brand"><BrandMark /><span>AURA</span></div>;
}
