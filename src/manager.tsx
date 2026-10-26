import { createRoot } from 'react-dom/client';
import { App } from './manager/app';

const container = document.getElementById('root');
if (!container) throw new Error('Application library mount point is missing.');
createRoot(container).render(<App />);
