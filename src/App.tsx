import PlannerApp from './ui/PlannerApp';
import { usePlannerDocument } from './state/usePlannerDocument';

export default function App() {
  const store = usePlannerDocument();
  return <PlannerApp store={store} />;
}
