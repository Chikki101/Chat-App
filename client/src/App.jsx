import { useAuth } from './context/AuthContext.jsx';
import Login from './pages/Login.jsx';
import Chat from './pages/Chat.jsx';

export default function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="splash">Loading…</div>;
  return user ? <Chat /> : <Login />;
}
