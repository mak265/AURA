import { useState } from 'react';

const safety = ['Harassment or bullying', 'Spam or unsolicited messages', 'Scam or fraud', 'Fake profile or impersonation', 'Underage account', 'Inappropriate or unsafe content', 'Repeated community guideline violations'];
const post = ['Harassment or bullying', 'Inappropriate or unsafe content', 'Spam or scam', 'Private information shared without permission', 'Misleading or impersonating content'];
const reviewed = ['Appeal approved', 'Review found no policy violation', 'Issue resolved after review'];
const presets = {
  warn: safety, restrict: safety, ban: safety,
  unrestrict: reviewed, unban: reviewed, restore_post: reviewed, hide_post: post,
  premium: ['Beta tester reward', 'Promotional giveaway', 'Account support adjustment'],
  unpremium: ['Promotional access ended', 'Account support adjustment', 'Premium granted in error']
};

export default function ManagementReason({ action, value, onChange }) {
  const [custom, setCustom] = useState(false);
  const options = presets[action] || safety;
  return <>
    <label>Reason shown to the user
      <select required value={custom ? 'custom' : value} onChange={event => {
        const selection = event.target.value;
        setCustom(selection === 'custom');
        onChange(selection === 'custom' ? '' : selection);
      }}>
        <option value="">Choose a reason</option>
        {options.map(reason => <option key={reason} value={reason}>{reason}</option>)}
        <option value="custom">Other reason</option>
      </select>
    </label>
    {custom && <label>Custom reason
      <textarea required minLength={5} maxLength={1000} value={value}
        onChange={event => onChange(event.target.value)} placeholder="Write a reason the affected user can read." />
    </label>}
  </>;
}
