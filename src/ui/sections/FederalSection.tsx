/**
 * US-905: the Federal dashboard is a placeholder in this release. Federal loan types, their stored
 * data and the general loan calculations are unchanged; federal tools (limits, income-driven plans,
 * program earnings) are deferred (US-405, US-1102).
 */
export function FederalSection() {
  return (
    <section id="federal" className="panel federal-coming-soon" aria-labelledby="federal-heading">
      <h2 id="federal-heading">Federal</h2>
      <p className="coming-soon"><strong>Coming soon</strong></p>
    </section>
  );
}
