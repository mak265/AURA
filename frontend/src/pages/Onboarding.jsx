import { ConnectionFields } from '../components/ConnectionProfile';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

const COLORS = [
  'linear-gradient(135deg,#a18baf,#b38d98)',
  'linear-gradient(135deg,#8a809d,#8ca7a1)',
  'linear-gradient(135deg,#b38d98,#c0a27c)',
  'linear-gradient(135deg,#8c9e8e,#8ca7a1)',
  'linear-gradient(135deg,#c0a27c,#b77f80)',
  'linear-gradient(135deg,#c7b5d0,#8a809d)',
];

const INTERESTS = [
  { id: 1, name: 'Music', emoji: '🎵' },
  { id: 2, name: 'Coffee', emoji: '☕' },
  { id: 3, name: 'Gaming', emoji: '🎮' },
  { id: 4, name: 'Hiking', emoji: '🥾' },
  { id: 5, name: 'Art', emoji: '🎨' },
  { id: 6, name: 'Reading', emoji: '📚' },
  { id: 7, name: 'Travel', emoji: '✈️' },
  { id: 8, name: 'Photography', emoji: '📷' },
  { id: 9, name: 'Fitness', emoji: '💪' },
  { id: 10, name: 'Movies', emoji: '🎬' },
  { id: 11, name: 'Food', emoji: '🍜' },
  { id: 12, name: 'Technology', emoji: '💻' },
];

export default function Onboarding() {
  const [step, setStep] = useState(1);
  const [auraName, setAuraName] = useState('');
  const [auraColor, setAuraColor] = useState(0);
  const [vibe, setVibe] = useState('');
  const [bio, setBio] = useState('');
  const [intention, setIntention] = useState('');
  const [answers, setAnswers] = useState(['', '', '']);
  const [selectedInterests, setSelectedInterests] = useState([]);
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('');
  const [religion, setReligion] = useState('');
  const [city, setCity] = useState('');
  const [realName, setRealName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { refreshUser } = useAuth();

  const toggleInterest = (id) => {
    setSelectedInterests(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleStep2 = async () => {
    setError('');
    if (!auraName.trim()) {
      setError('Aura name is required.');
      return;
    }
    setLoading(true);
    try {
      await api.put('/aura', {
        aura_name: auraName,
        aura_color: COLORS[auraColor],
        vibe,
        bio,
        dating_intention: intention,
        prompt_answers: answers,
        emoji: '🌌',
        interests: selectedInterests,
      });
      setStep(3);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save aura.');
    } finally {
      setLoading(false);
    }
  };

  const handleStep3 = async () => {
    setError('');
    setLoading(true);
    try {
      await api.put('/aura/about', {
        age: parseInt(age) || null,
        gender,
        religion,
        city,
        real_name: realName,
      });
      await refreshUser();
      navigate('/discover');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-aura-deep pb-32">
      <div className="px-5 pt-8">
        <div className="text-xs font-bold text-aura-violet-light tracking-widest">STEP {step} OF 3</div>
        <h1 className="text-2xl font-extrabold mt-1">
          {step === 1 && 'Create Your Account'}
          {step === 2 && 'Create Your Aura'}
          {step === 3 && 'About You'}
        </h1>
        <p className="text-sm text-gray-400 mt-1">
          {step === 1 && 'We need an email and password to secure your account.'}
          {step === 2 && 'This is how others will see you. Stay anonymous.'}
          {step === 3 && 'These details are private and only used for matching.'}
        </p>
        <div className="flex gap-1.5 mt-4">
          {[1, 2, 3].map(s => (
            <div key={s} className={`h-1 flex-1 rounded-full ${s <= step ? 'bg-gradient-to-r from-aura-violet to-aura-pink' : 'bg-aura-elevated'}`} />
          ))}
        </div>
      </div>

      {/* Step 1: Account already created via signup, skip to step 2 */}
      {step === 1 && (
        <div className="px-5 mt-6 flex flex-col gap-4">
          <p className="text-gray-300 text-sm">Your account is ready. Let's create your aura!</p>
          <button className="aura-btn-primary" onClick={() => setStep(2)}>Continue</button>
        </div>
      )}

      {/* Step 2: Create Aura */}
      {step === 2 && (
        <div className="px-5 mt-5">
          {/* Live preview */}
          <div className="aura-card p-5 text-center mb-5"
            style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(236,72,153,0.1)), #211d24' }}>
            <div className="w-16 h-16 rounded-full mx-auto mb-2 aura-orb flex items-center justify-center text-2xl">🌌</div>
            <div className="text-lg font-extrabold">{auraName || 'Your Aura Name'}</div>
            <div className="text-xs text-aura-violet-light mt-1">
              {selectedInterests.map(id => INTERESTS.find(i => i.id === id)?.name).join(' • ') || 'Select interests'}
            </div>
            <div className="text-xs text-gray-400 mt-2 italic">"{bio || 'Your bio will appear here'}"</div>
          </div>

          <div className="mb-4">
            <label className="text-xs font-semibold text-gray-400 mb-2 block">AURA NAME</label>
            <input className="aura-input" value={auraName} onChange={e => setAuraName(e.target.value)} placeholder="e.g. LunaAura" />
          </div>

          <div className="mb-4">
            <label className="text-xs font-semibold text-gray-400 mb-2 block">AURA COLOR</label>
            <div className="flex gap-2.5 flex-wrap">
              {COLORS.map((c, i) => (
                <div
                  key={i}
                  onClick={() => setAuraColor(i)}
                  className={`w-8 h-8 rounded-full cursor-pointer border-2 ${auraColor === i ? 'border-white' : 'border-transparent'}`}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>

          <div className="mb-4">
            <label className="text-xs font-semibold text-gray-400 mb-2 block">VIBE</label>
            <select className="aura-input" value={vibe} onChange={e => setVibe(e.target.value)}>
              <option value="">Select your vibe...</option>
              <option value="Mysterious & Creative">🌙 Mysterious & Creative</option>
              <option value="Adventurous & Bold">🔥 Adventurous & Bold</option>
              <option value="Calm & Laid-back">🌿 Calm & Laid-back</option>
              <option value="Energetic & Fun">🎉 Energetic & Fun</option>
              <option value="Deep & Thoughtful">📚 Deep & Thoughtful</option>
              <option value="Sweet & Caring">💝 Sweet & Caring</option>
              <option value="Witty & Playful">✨ Witty & Playful</option>
              <option value="Ambitious & Driven">🚀 Ambitious & Driven</option>
              <option value="Artistic & Dreamy">🎨 Artistic & Dreamy</option>
              <option value="Chill & Go-with-the-flow">🌊 Chill & Go-with-the-flow</option>
              <option value="Romantic & Passionate">🌹 Romantic & Passionate</option>
              <option value="Intellectual & Curious">🧠 Intellectual & Curious</option>
              <option value="Spontaneous & Wild">🎲 Spontaneous & Wild</option>
              <option value="Grounded & Reliable">🌳 Grounded & Reliable</option>
              <option value="Quirky & Unique">🦄 Quirky & Unique</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <div className="mb-4">
            <label className="text-xs font-semibold text-gray-400 mb-2 block">BIO</label>
            <textarea className="aura-input resize-none" rows={2} value={bio} onChange={e => setBio(e.target.value)} placeholder="Tell others about your vibe..." />
          </div>

          <div className="mb-4">
            <label className="text-xs font-semibold text-gray-400 mb-2 block">INTERESTS</label>
            <div className="flex gap-2 flex-wrap">
              {INTERESTS.map(i => (
                <div
                  key={i.id}
                  onClick={() => toggleInterest(i.id)}
                  className={`px-3.5 py-2 rounded-full text-xs font-semibold cursor-pointer ${selectedInterests.includes(i.id) ? 'bg-aura-violet/20 border border-aura-violet text-white' : 'bg-aura-card border border-aura-border text-gray-400'}`}
                >
                  {i.name}
                </div>
              ))}
            </div>
          </div>

          <div className="mb-5"><ConnectionFields intention={intention} setIntention={setIntention} answers={answers} setAnswers={setAnswers} /></div>
          {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
          <button className="aura-btn-primary" onClick={handleStep2} disabled={loading}>
            {loading ? 'Saving...' : 'Continue'}
          </button>
        </div>
      )}

      {/* Step 3: About You */}
      {step === 3 && (
        <div className="px-5 mt-5 flex flex-col gap-4">
          <div>
            <label className="text-xs font-semibold text-gray-400 mb-2 block">AGE</label>
            <input type="number" className="aura-input" value={age} onChange={e => setAge(e.target.value)} placeholder="18" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-400 mb-2 block">GENDER</label>
            <select className="aura-input" value={gender} onChange={e => setGender(e.target.value)}>
              <option value="">Select...</option>
              <option value="Female">Female</option>
              <option value="Male">Male</option>
              <option value="Nonbinary">Nonbinary</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-400 mb-2 block">RELIGION</label>
            <select className="aura-input" value={religion} onChange={e => setReligion(e.target.value)}>
              <option value="">Select...</option>
              <option value="Iglesia ni Cristo">Iglesia ni Cristo</option>
              <option value="Catholic">Catholic</option>
              <option value="Born Again / Evangelical">Born Again / Evangelical</option>
              <option value="Christian">Christian</option>
              <option value="Seventh-day Adventist">Seventh-day Adventist</option>
              <option value="Jehovah's Witnesses">Jehovah's Witnesses</option>
              <option value="Mormon / Latter Day Saints">Mormon / Latter Day Saints</option>
              <option value="Pentecostal">Pentecostal</option>
              <option value="Baptist">Baptist</option>
              <option value="Methodist">Methodist</option>
              <option value="Protestant">Protestant</option>
              <option value="Muslim">Muslim</option>
              <option value="Buddhist">Buddhist</option>
              <option value="Hindu">Hindu</option>
              <option value="Jewish">Jewish</option>
              <option value="Sikh">Sikh</option>
              <option value="Taoist">Taoist</option>
              <option value="Baha'i">Baha'i</option>
              <option value="Agnostic">Agnostic</option>
              <option value="Atheist">Atheist</option>
              <option value="Spiritual">Spiritual</option>
              <option value="Other">Other</option>
              <option value="Prefer not to say">Prefer not to say</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-400 mb-2 block">CITY</label>
            <input className="aura-input" value={city} onChange={e => setCity(e.target.value)} placeholder="e.g. Manila" />
          </div>
          <div className="aura-card p-3" style={{ background: 'rgba(245,158,11,0.08)', borderColor: 'rgba(245,158,11,0.3)' }}>
            <div className="flex items-center gap-2">
              <span>🔒</span>
              <div>
                <div className="text-sm font-bold">Private Identity</div>
                <div className="text-xs text-gray-400">Only revealed after mutual consent.</div>
              </div>
            </div>
            <input className="aura-input mt-3" value={realName} onChange={e => setRealName(e.target.value)} placeholder="Your real name (private)" />
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button className="aura-btn-primary" onClick={handleStep3} disabled={loading}>
            {loading ? 'Finishing...' : 'Finish & Explore'}
          </button>
        </div>
      )}
    </div>
  );
}
