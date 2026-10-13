import { useState, type FormEvent } from 'react';
import M1Preview from './M1Preview';
import { savePlan, type Plan, type PlanErrors } from './engine/plan';

export default function App() {
  const [plan, setPlan] = useState<Plan>();
  const [startDate, setStartDate] = useState('');
  const [graduationDate, setGraduationDate] = useState('');
  const [errors, setErrors] = useState<PlanErrors>({});
  const [message, setMessage] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    const result = savePlan(startDate, graduationDate, plan);
    if (!result.ok) { setErrors(result.errors); setMessage(''); return; }
    setPlan(result.plan);
    setErrors({});
    setMessage(plan ? 'Plan updated.' : 'Plan created.');
  }

  return <main>
    <h1>DebtNav</h1>
    <p>Your path through school starts with a plan.</p>
    <h2>{plan ? 'Edit your plan' : 'Create your plan'}</h2>
    <form onSubmit={submit} noValidate>
      <label htmlFor="start">School start date</label>
      <input id="start" type="date" required value={startDate} onChange={e => setStartDate(e.target.value)}
        aria-invalid={!!errors.startDate} aria-describedby={errors.startDate ? 'start-error' : undefined} />
      {errors.startDate && <p id="start-error" role="alert">{errors.startDate}</p>}
      <label htmlFor="graduation">Expected graduation date</label>
      <input id="graduation" type="date" required value={graduationDate} onChange={e => setGraduationDate(e.target.value)}
        aria-invalid={!!errors.graduationDate} aria-describedby={errors.graduationDate ? 'graduation-error' : undefined} />
      {errors.graduationDate && <p id="graduation-error" role="alert">{errors.graduationDate}</p>}
      <p>Each school year starts on your enrollment anniversary. The final year ends at graduation.</p>
      <button type="submit">{plan ? 'Save changes' : 'Create plan'}</button>
    </form>
    <p role="status">{message}</p>
    {plan && <section aria-labelledby="years-heading">
      <h2 id="years-heading">School years ({plan.schoolYears.length})</h2>
      <ol>{plan.schoolYears.map((year, index) => <li key={year.id}>
        <strong>Year {index + 1}</strong>: <time dateTime={year.startDate}>{year.startDate}</time> to{' '}
        <time dateTime={year.endDate}>{year.endDate}</time>
      </li>)}</ol>
    </section>}
    <M1Preview />
  </main>;
}

