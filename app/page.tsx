'use client';

import { useSimulation } from '@/hooks/useSimulation';

export default function Page() {
  const { snapshot, isPaused, togglePause, reset } = useSimulation();

  return (
    <div className="p-8 text-white">
      <pre>{JSON.stringify(snapshot, null, 2)}</pre>
      <button onClick={togglePause}>{isPaused ? 'Resume' : 'Pause'}</button>
      <button onClick={reset}>Reset</button>
    </div>
  );
}