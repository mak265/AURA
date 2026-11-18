export default function WorkStatusOptions({ emptyLabel }) {
  return <>
    <option value="">{emptyLabel}</option>
    <option value="student">Student</option>
    <option value="working">Working individual</option>
  </>;
}
