import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Agents from './pages/Agents';
import Incidents from './pages/Incidents';
import Infrastructure from './pages/Infrastructure';
import DataSources from './pages/DataSources';
import Runbooks from './pages/Runbooks';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/agents" element={<Agents />} />
          <Route path="/incidents" element={<Incidents />} />
          <Route path="/infrastructure" element={<Infrastructure />} />
          <Route path="/datasources" element={<DataSources />} />
          <Route path="/runbooks" element={<Runbooks />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
