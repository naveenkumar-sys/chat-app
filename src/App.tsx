import { useState, useEffect } from 'react';
import Chat from './components/Chat';
import Auth from './components/Auth';
import { insforge } from './lib/insforge';

function App() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Automatically attempt to fetch user on load
  useEffect(() => {
    const init = async () => {
      try {
        const { data } = await insforge.auth.getCurrentUser();
        if (data?.user) {
          setUser(data.user);
        }
      } catch (e) {
        console.warn('Session startup context warn:', e);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  // Sync profile when user changes
  useEffect(() => {
    if (user) {
      // Upsert profile whenever user signs in to ensure they are in the directory
      // Using 'id' as the column name based on user's screenshot
      insforge.database.from('profiles').insert([{ 
        id: user.id, 
        email: user.email,
        last_seen: new Date().toISOString()
      }]).then(() => {
        // Ignore unique constraint errors
      });
    }
  }, [user]);

  const handleLogout = async () => {
    await insforge.auth.signOut();
    setUser(null);
  };

  if (loading) {
    return (
      <div className="h-screen w-full bg-black flex items-center justify-center">
        <div className="w-8 h-8 rounded-full bg-indigo-500 animate-ping" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-black text-white font-sans overflow-hidden">
      {/* Navigation Header */}
      <header className="flex justify-between items-center px-6 py-4 border-b border-neutral-800 bg-neutral-950/80 backdrop-blur-md z-20 shadow-sm shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold tracking-tight bg-gradient-to-r from-white to-neutral-400 bg-clip-text text-transparent">Chatify!</h1>
        </div>
        
        <div className="flex items-center gap-4 cursor-pointer">
          {user && (
            <div className="flex items-center gap-3">
              <span className="text-sm font-medium text-neutral-400 hidden sm:block flex-1 max-w-[120px] truncate" title={user.email}>
                {user.email}
              </span>
              <button 
                onClick={handleLogout}
                className="px-4 py-2 text-sm font-medium bg-neutral-800 hover:bg-neutral-700 text-white rounded-full transition-colors active:scale-95 shrink-0"
              >
                Sign Out
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 w-full bg-black relative flex flex-col min-h-0">
        {!user ? (
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-900/20 via-black to-black flex items-center justify-center px-4 sm:p-6 pb-20 overflow-y-auto">
             <div className="w-full max-w-md animate-in fade-in slide-in-from-bottom-4 duration-700">
               <Auth onSuccess={(newUser) => setUser(newUser)} />
             </div>
          </div>
        ) : (
          <div className="h-full w-full max-w-6xl mx-auto py-0 sm:py-6 sm:px-6 z-10 flex flex-col">
            <div className="flex-1 rounded-none sm:rounded-2xl overflow-hidden ring-1 ring-neutral-800 shadow-2xl bg-neutral-950 flex flex-col min-h-0">
              <Chat user={user} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
