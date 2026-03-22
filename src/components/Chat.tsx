import { useEffect, useState, useRef, FormEvent } from 'react';
import { insforge } from '../lib/insforge';
import { Send, UserCircle2, MessageSquareOff, ChevronLeft, Image as ImageIcon, Smile, Loader2, Settings, User, Palette, X, MoreVertical, Trash2, ChevronDown } from 'lucide-react';

interface DirectMessage {
  id: string;
  sender_id: string;
  sender_email: string;
  receiver_id: string;
  receiver_email: string;
  text: string | null;
  image_url?: string;
  client_id?: string;
  created_at: string;
  deleted_for_sender?: boolean;
  deleted_for_receiver?: boolean;
}

interface UserProfile {
  id: string;
  email: string;
  lastSeen?: number;
  isOnline?: boolean;
  isTyping?: boolean;
  name?: string;
  avatar_url?: string;
}

interface ChatProps {
  user: any;
}

export default function Chat({ user }: ChatProps) {
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  
  // Track all users we interact with, plus currently online users
  const [contacts, setContacts] = useState<Map<string, UserProfile>>(new Map());
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [myProfile, setMyProfile] = useState({
    name: '',
    bio: '',
    avatar_url: '',
    chat_bubble_color: '#4f46e5',
    chat_background_color: '#0b0f19',
    chat_background_image: ''
  });
  const [draftProfile, setDraftProfile] = useState({
    name: '',
    bio: '',
    avatar_url: '',
    chat_bubble_color: '#4f46e5',
    chat_background_color: '#0b0f19',
    chat_background_image: ''
  });
  const [isSaving, setIsSaving] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const profileImageInputRef = useRef<HTMLInputElement>(null);
  const bgImageInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [showChatMenu, setShowChatMenu] = useState(false);
  const [msgMenuOpen, setMsgMenuOpen] = useState<string | null>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Scroll to bottom on new message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load my own profile data
  useEffect(() => {
    const fetchMyProfile = async () => {
      const { data, error } = await insforge.database
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      
      if (data && !error) {
        setMyProfile({
          name: data.name || '',
          bio: data.bio || '',
          avatar_url: data.avatar_url || '',
          chat_bubble_color: data.chat_bubble_color || '#4f46e5',
          chat_background_color: data.chat_background_color || '#0b0f19',
          chat_background_image: data.chat_background_image || ''
        });
      }
    };
    fetchMyProfile();
  }, [user.id]);

  // Load all users from profiles table to see offline users
  useEffect(() => {
    const fetchUsers = async () => {
      // Using 'id' as the column name based on user's screenshot
      const { data, error } = await insforge.database.from('profiles').select('id, email, name, avatar_url');
      if (data && !error) {
        const loadedContacts = new Map<string, UserProfile>();
        data.forEach((p: any) => {
          if (p.id !== user.id) {
            loadedContacts.set(p.id, {
              id: p.id,
              email: p.email,
              name: p.name,
              avatar_url: p.avatar_url,
              isOnline: false
            });
          }
        });
        setContacts(loadedContacts);
      }
    };
    fetchUsers();
  }, [user.id]);

  // Handle switching users - Load conversation history
  useEffect(() => {
    if (!user || !selectedUserId) return;

    const fetchHistory = async () => {
      const { data, error } = await insforge.database
        .from('messages') // Using 'messages' table based on screenshot
        .select('*')
        .or(`and(sender_id.eq.${user.id},receiver_id.eq.${selectedUserId}),and(sender_id.eq.${selectedUserId},receiver_id.eq.${user.id})`)
        .order('created_at', { ascending: false })
        .limit(50);
      
      if (data && !error) {
        setMessages((data as DirectMessage[]).reverse());
      }
    };

    fetchHistory();
  }, [selectedUserId, user]);

  // Realtime setup for incoming messages and presence
  useEffect(() => {
    if (!user) return;

    let cleanupInterval: ReturnType<typeof setInterval>;
    
    const connectRealtime = async () => {
      await insforge.realtime.connect();
      const { ok } = await insforge.realtime.subscribe('chat:room-1'); // Shared channel
      
      if (ok) {
        // Listen to DM triggers
        insforge.realtime.on('new_message', (payload: any) => {
          // The SDK might pass the message directly or nested in payload.payload
          const msg = (payload.payload || payload) as DirectMessage;
          
          if (!msg.sender_id) return; // Not a valid message payload

          // Ensure the sender email/id is in our contact list
          const otherId = msg.sender_id === user.id ? msg.receiver_id : msg.sender_id;
          const otherEmail = msg.sender_id === user.id ? msg.receiver_email : msg.sender_email;

          if (otherId && otherId !== user.id) {
            setContacts(prev => {
              const existing = prev.get(otherId);
              if (existing) return prev;
              const next = new Map(prev);
              next.set(otherId, { 
                id: otherId, 
                email: otherEmail, 
                isOnline: true, 
                lastSeen: Date.now(),
                isTyping: false
              });
              return next;
            });
          }

          // Does this message belong to my active chat?
          const isRelevantToActiveChat = 
             selectedUserId && 
             ((msg.sender_id === user.id && msg.receiver_id === selectedUserId) ||
              (msg.sender_id === selectedUserId && msg.receiver_id === user.id));

          if (isRelevantToActiveChat) {
            setMessages(prev => {
              // De-duplicate: check if we already have this server-assigned ID,
              // OR if this message matches a client-generated ID we have.
              const alreadyHas = prev.find(m => 
                m.id === msg.id || 
                (msg.client_id && m.id === msg.client_id) || 
                (msg.client_id && m.client_id === msg.client_id)
              );
              if (alreadyHas) {
                // If it's the optimistic match, update it with real server data immediately (like ID/created_at)
                return prev.map(m => (msg.client_id && m.id === msg.client_id) ? msg : m);
              }
              return [...prev, msg];
            });
          }
        });

        // Listen for message deletion
        insforge.realtime.on('message_deleted', (payload: any) => {
          const { message_id } = payload.payload || payload;
          if (message_id) {
            setMessages(prev => prev.filter(m => m.id !== message_id && m.client_id !== message_id));
          }
        });

        // Listen for typing events
        insforge.realtime.on('typing', (payload: any) => {
          const { user_id, is_typing } = payload;
          if (user_id === user.id) return;

          setContacts(prev => {
            const next = new Map(prev);
            const contact = next.get(user_id);
            if (contact) {
              next.set(user_id, { ...contact, isTyping: is_typing });
            }
            return next;
          });
        });

        // Presence pings to maintain live indicators
        insforge.realtime.on('presence:ping', (payload: any) => {
          if (!payload.user_id || !payload.email) return;
          if (payload.user_id === user.id) return; 
          
          setContacts(prev => {
            const next = new Map(prev);
            const existing = next.get(payload.user_id);
            next.set(payload.user_id, {
              ...(existing || {}),
              id: payload.user_id,
              email: payload.email,
              isOnline: true,
              lastSeen: Date.now(),
              isTyping: existing?.isTyping ?? false
            });
            return next;
          });
        });

        // Listen to profile updates
        insforge.realtime.on('profile_update', (msg: any) => {
          const payload = msg.payload || msg;
          if (!payload || !payload.id) return;
          
          if (payload.id === user.id) {
             setMyProfile(prev => ({
                ...prev,
                name: payload.name ?? prev.name,
                avatar_url: payload.avatar_url ?? prev.avatar_url,
                chat_bubble_color: payload.chat_bubble_color ?? prev.chat_bubble_color,
                chat_background_color: payload.chat_background_color ?? prev.chat_background_color,
                chat_background_image: payload.chat_background_image ?? prev.chat_background_image
             }));
          } else {
             setContacts(prev => {
                const next = new Map(prev);
                const contact = next.get(payload.id);
                if (contact) {
                   next.set(payload.id, {
                      ...contact,
                      name: payload.name ?? contact.name,
                      avatar_url: payload.avatar_url ?? contact.avatar_url
                   });
                }
                return next;
             });
          }
        });

        // Broadcast presence
        cleanupInterval = setInterval(() => {
          if (insforge.realtime.isConnected) {
            insforge.realtime.publish('chat:room-1', 'presence:ping', {
              user_id: user.id,
              email: user.email
            });
          }
        }, 5000);
        
        if (insforge.realtime.isConnected) {
          insforge.realtime.publish('chat:room-1', 'presence:ping', {
            user_id: user.id,
            email: user.email
          });
        }
      }
    };

    connectRealtime();

    // Mark contacts as offline after timeout
    const staleInterval = setInterval(() => {
      setContacts(prev => {
        const next = new Map(prev);
        const now = Date.now();
        let changed = false;
        for (const [key, val] of next.entries()) {
          if (val.isOnline && val.lastSeen && now - val.lastSeen > 20000) {
            next.set(key, { ...val, isOnline: false });
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 5000);

    return () => {
      clearInterval(staleInterval);
      if (cleanupInterval) clearInterval(cleanupInterval);
      insforge.realtime.unsubscribe('chat:room-1');
    };
  }, [user, selectedUserId]);

  const handleSend = async (e?: FormEvent, textContent?: string, imageUrl?: string) => {
    e?.preventDefault();
    if ((!newMessage.trim() && !textContent && !imageUrl) || !user || !selectedUserId) return;

    const text = textContent || newMessage.trim() || null;
    const imgUrl = imageUrl || undefined;
    
    if (!textContent) setNewMessage('');
    
    const recipient = contacts.get(selectedUserId);
    if (!recipient) return;

    // Optimistic UI update
    const tempId = crypto.randomUUID();
    const tempMsg: DirectMessage = {
      id: tempId,
      sender_id: user.id,
      sender_email: user.email,
      receiver_id: selectedUserId,
      receiver_email: recipient.email,
      text,
      image_url: imgUrl,
      created_at: new Date().toISOString()
    };
    
    setMessages(prev => [...prev, tempMsg]);

    const { data, error } = await insforge.database
      .from('messages') // Using 'messages' table based on screenshot
      .insert({
        sender_id: user.id,
        sender_email: user.email,
        receiver_id: selectedUserId,
        receiver_email: recipient.email,
        text, // Using 'text' instead of 'content' based on screenshot
        image_url: imgUrl,
        client_id: tempId
      })
      .select('id, created_at')
      .single();
      
    if (data) {
      setMessages(prev => prev.map(m => m.id === tempId ? { ...m, ...data } : m));
    } else if (error) {
      console.error('Failed to send DM:', error);
      // Revert optimistic
      setMessages(prev => prev.filter(m => m.id !== tempId));
    }
  };

  const handleDeleteMessage = async (msgId: string, deleteForEveryone: boolean = true, isSender: boolean = true) => {
    setMsgMenuOpen(null);
    if (!confirm(deleteForEveryone ? 'Delete this message for everyone?' : 'Delete this message for you?')) return;
    
    if (deleteForEveryone) {
      // Optimistic UI update
      setMessages(prev => prev.filter(m => m.id !== msgId));
      
      // Database delete
      await insforge.database.from('messages').delete().eq('id', msgId);
      
      // Broadcast message deletion so other client removes it if they are online
      if (insforge.realtime.isConnected) {
        insforge.realtime.publish('chat:room-1', 'message_deleted', { message_id: msgId });
      }
    } else {
      // Optimistic UI update for 'Delete for me'
      setMessages(prev => prev.map(m => m.id === msgId ? { 
         ...m, 
         deleted_for_sender: isSender ? true : m.deleted_for_sender,
         deleted_for_receiver: !isSender ? true : m.deleted_for_receiver 
      } : m));
      
      const updatePayload = isSender ? { deleted_for_sender: true } : { deleted_for_receiver: true };
      await insforge.database.from('messages').update(updatePayload).eq('id', msgId);
    }
  };

  const handleTouchStart = (msgId: string) => {
    longPressTimerRef.current = setTimeout(() => {
      setMsgMenuOpen(msgId);
    }, 2000); // 2 seconds delay
  };
  
  const handleTouchEnd = () => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedUserId) return;

    setIsUploading(true);
    try {
      const { data, error } = await insforge.storage.from('chat-attachments').uploadAuto(file);
      if (data?.url) {
        await handleSend(undefined, undefined, data.url);
      } else if (error) {
        throw error;
      }
    } catch (error) {
      console.error('Upload failed:', error);
      alert('Failed to upload image');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const commonEmojis = ['😊', '😂', '🔥', '❤️', '👍', '🙌', '🎉', '✨', '🤔', '👋'];

  const addEmoji = (emoji: string) => {
    setNewMessage(prev => prev + emoji);
    setShowEmojiPicker(false);
    handleTyping();
  };

  const handleTyping = () => {
    if (!insforge.realtime.isConnected) return;

    // Publish typing start
    insforge.realtime.publish('chat:room-1', 'typing', {
      user_id: user.id,
      is_typing: true
    });

    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    
    typingTimeoutRef.current = setTimeout(() => {
      insforge.realtime.publish('chat:room-1', 'typing', {
        user_id: user.id,
        is_typing: false
      });
    }, 3000);
  };

  const handleProfileUpdate = async (e: FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    const { error: updateError } = await insforge.database
      .from('profiles')
      .update({
        name: draftProfile.name,
        bio: draftProfile.bio,
        avatar_url: draftProfile.avatar_url,
        chat_bubble_color: draftProfile.chat_bubble_color,
        chat_background_color: draftProfile.chat_background_color,
        chat_background_image: draftProfile.chat_background_image
      })
      .eq('id', user.id)
      .select()
      .single();
    
    setIsSaving(false);
    if (!updateError) {
      setMyProfile({ ...draftProfile });
      setShowSettings(false);
      
      // Notify other clients instantly
      if (insforge.realtime.isConnected) {
        insforge.realtime.publish('chat:room-1', 'profile_update', {
          id: user.id,
          name: draftProfile.name,
          avatar_url: draftProfile.avatar_url,
          chat_bubble_color: draftProfile.chat_bubble_color,
          chat_background_color: draftProfile.chat_background_color,
          chat_background_image: draftProfile.chat_background_image
        });
      }
    } else {
      console.error("Profile update failed:", updateError);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsSaving(true);
    try {
      const { data, error } = await insforge.storage.from('chat-attachments').uploadAuto(file);
      if (error) console.error("Avatar upload failed:", error);
      if (data?.url) {
        setDraftProfile(prev => ({ ...prev, avatar_url: data.url }));
      }
    } finally {
      setIsSaving(false);
    }
  };

  const selectedContact = selectedUserId ? contacts.get(selectedUserId) : null;

  return (
    <div className="flex flex-col sm:flex-row h-full w-full bg-[#0B0F19] overflow-hidden relative">
      {/* Sidebar - Contacts List */}
      <div className={`sm:border-r border-neutral-800 bg-neutral-950 flex flex-col shrink-0 shadow-inner z-10 w-full sm:w-[360px] ${selectedUserId ? 'hidden sm:flex' : 'flex'}`}>
        <div className="p-5 border-b border-neutral-800 bg-neutral-900/40">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold text-white">Messages</h2>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => {
                  setDraftProfile({ ...myProfile });
                  setShowSettings(true);
                }}
                className="p-2 hover:bg-neutral-800 rounded-lg text-neutral-400 hover:text-white transition-colors"
                title="Settings"
              >
                <Settings className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-500/10 border border-green-500/20">
                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-[10px] uppercase font-bold text-green-500 tracking-wider">
                  {Array.from(contacts.values()).filter(c => c.isOnline).length} Active
                </span>
              </div>
            </div>
          </div>
          <div className="mt-4 relative group">
            <input 
              type="text" 
              placeholder="Search conversations..." 
              className="w-full bg-neutral-900 border border-neutral-800 text-sm rounded-xl py-2.5 px-4 outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30 transition-all text-neutral-300 placeholder:text-neutral-500"
            />
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-2 space-y-1 scrollbar-hide">
          {contacts.size === 0 ? (
            <div className="p-10 text-center text-sm text-neutral-600 space-y-3">
              <UserCircle2 className="w-12 h-12 mx-auto opacity-10" />
              <p>No contacts found yet</p>
            </div>
          ) : (
            Array.from(contacts.values()).map(contact => {
              const isActive = selectedUserId === contact.id;
              return (
                <button
                  key={contact.id}
                  onClick={() => setSelectedUserId(contact.id)}
                  className={`w-full flex items-center gap-3 px-4 py-4 rounded-xl transition-all relative group
                    ${isActive 
                      ? 'bg-indigo-600/10 border-indigo-500/20' 
                      : 'hover:bg-neutral-900/50'}`}
                >
                  {isActive && <div className="absolute left-0 top-3 bottom-3 w-1 bg-indigo-500 rounded-r-full" />}
                  <div className="relative shrink-0">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold text-white shadow-xl transition-all ${isActive ? 'bg-indigo-600 ring-4 ring-indigo-600/20' : 'bg-neutral-800'}`}>
                    {contact.avatar_url ? (
                      <img src={contact.avatar_url} className="w-full h-full rounded-full object-cover" />
                    ) : (
                      (contact.name || contact.email).charAt(0).toUpperCase()
                    )}
                  </div>
                    {contact.isOnline ? (
                      <div className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-neutral-950 rounded-full flex items-center justify-center">
                        <div className="w-2.5 h-2.5 rounded-full bg-green-500 ring-2 ring-neutral-950" />
                      </div>
                    ) : (
                      <div className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-neutral-950 rounded-full flex items-center justify-center">
                        <div className="w-2.5 h-2.5 rounded-full bg-neutral-600 ring-2 ring-neutral-950" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <div className="flex justify-between items-baseline mb-0.5">
                      <p className={`text-[15px] font-bold truncate ${isActive ? 'text-indigo-400' : 'text-neutral-200'}`}>
                        {contact.name || contact.email.split('@')[0]}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                       <p className={`text-xs truncate ${contact.isTyping ? 'text-indigo-400 animate-pulse font-bold' : contact.isOnline ? 'text-green-500' : 'text-neutral-500'}`}>
                        {contact.isTyping ? 'typing...' : contact.isOnline ? 'Active Now' : 'Offline'}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div 
        className={`flex-1 flex flex-col relative w-full overflow-hidden ${!selectedUserId ? 'hidden sm:flex' : 'flex'}`} 
        style={{ 
          backgroundColor: myProfile.chat_background_color,
          backgroundImage: myProfile.chat_background_image ? `url(${myProfile.chat_background_image})` : 'none',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat'
        }}
      >
        {!selectedUserId ? (
          <div className="flex-1 flex flex-col items-center justify-center text-neutral-500 space-y-6 p-8 relative">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(79,70,229,0.05)_0%,_transparent_70%)]" />
            <div className="w-24 h-24 rounded-[32px] bg-neutral-900/50 flex items-center justify-center shadow-inner relative z-10 border border-neutral-800/30">
              <MessageSquareOff className="w-10 h-10 text-neutral-700" />
            </div>
            <div className="text-center z-10">
              <h3 className="text-2xl font-bold text-neutral-300 mb-2">WhatsApp for Desktop</h3>
              <p className="max-w-xs text-sm text-neutral-500 leading-relaxed font-medium">Select a contact to view your secure end-to-end conversation.</p>
            </div>
          </div>
        ) : (
          <>
            {/* Header for Active Chat */}
            <div className="flex items-center gap-4 px-4 sm:px-8 py-5 border-b border-neutral-800/50 bg-[#0B0F19]/80 shrink-0 sticky top-0 z-20 shadow-sm backdrop-blur-xl">
              <button 
                onClick={() => setSelectedUserId(null)}
                className="sm:hidden p-2.5 -ml-2 text-neutral-400 hover:text-white rounded-xl bg-neutral-900/50 active:scale-90 transition-transform"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              
              <div className="flex items-center gap-4">
                <div className="relative">
                  <div className="w-11 h-11 rounded-full bg-neutral-800 ring-2 ring-neutral-800 flex items-center justify-center text-base font-bold text-white shadow-xl overflow-hidden">
                    {selectedContact?.avatar_url ? (
                      <img src={selectedContact.avatar_url} className="w-full h-full object-cover" />
                    ) : (
                      (selectedContact?.name || selectedContact?.email || '?').charAt(0).toUpperCase()
                    )}
                  </div>
                  {selectedContact?.isOnline && (
                    <div className="absolute bottom-0 right-0 w-3 h-3 bg-[#0B0F19] rounded-full flex items-center justify-center ring-2 ring-[#0B0F19]">
                      <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" />
                    </div>
                  )}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-neutral-100 leading-tight">
                    {selectedContact?.name || selectedContact?.email?.split('@')[0]}
                  </h3>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <div className={`w-1.5 h-1.5 rounded-full ${selectedContact?.isTyping ? 'bg-indigo-400 animate-pulse' : selectedContact?.isOnline ? 'bg-green-500 animate-pulse' : 'bg-neutral-600'}`} />
                    <p className={`text-xs font-bold uppercase tracking-widest ${selectedContact?.isTyping ? 'text-indigo-400' : selectedContact?.isOnline ? 'text-green-500/80' : 'text-neutral-500'}`}>
                      {selectedContact?.isTyping ? 'Typing...' : selectedContact?.isOnline ? 'Online' : 'Offline'}
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="relative ml-auto">
                <button 
                  onClick={() => setShowChatMenu(!showChatMenu)}
                  className="p-2 text-neutral-400 hover:text-white rounded-xl bg-[#0B0F19]/20 hover:bg-neutral-800 transition-colors border border-transparent hover:border-neutral-700/50"
                  title="Chat Options"
                >
                  <MoreVertical className="w-5 h-5" />
                </button>
                {showChatMenu && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowChatMenu(false)} />
                    <div className="absolute right-0 top-full mt-2 w-48 bg-neutral-900 border border-neutral-800 rounded-xl shadow-2xl overflow-hidden z-50 animate-in fade-in slide-in-from-top-2">
                      <button
                        onClick={async () => {
                          setShowChatMenu(false);
                          if (!user || !selectedUserId || !confirm('Are you sure you want to clear this entire chat history globally?')) return;
                          
                          setMessages([]);
                          await insforge.database
                            .from('messages')
                            .delete()
                            .or(`and(sender_id.eq.${user.id},receiver_id.eq.${selectedUserId}),and(sender_id.eq.${selectedUserId},receiver_id.eq.${user.id})`);
                        }}
                        className="w-full px-4 py-3 text-sm font-bold text-red-400 hover:text-red-300 hover:bg-neutral-800 flex items-center gap-3 transition-colors text-left"
                      >
                        <Trash2 className="w-4 h-4" />
                        Clear Chat
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Message Pane */}
            <div className="flex-1 overflow-y-auto scroll-smooth bg-[url('https://asset.cloudinary.com/dv5hp0d9z/591eb1ccb593f6b9c9f0c72e259b122c')] bg-repeat scrollbar-hide">
              <div className="p-4 sm:p-10 space-y-4 flex flex-col min-h-full justify-end flex-1 break-words pb-8">
                {messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-neutral-500 py-10 opacity-70">
                    <p className="bg-neutral-800/40 backdrop-blur-xl px-4 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wider text-neutral-400 border border-neutral-700/30">
                      Messages are end-to-end encrypted
                    </p>
                  </div>
                ) : (
                  messages.filter(msg => {
                    const isMe = msg.sender_id === user?.id;
                    return !((isMe && msg.deleted_for_sender) || (!isMe && msg.deleted_for_receiver));
                  }).map((msg, index, arr) => {
                    const isMe = msg.sender_id === user?.id;
                    const prevMsg = index > 0 ? arr[index - 1] : null;
                    const sameSenderAsPrev = prevMsg?.sender_id === msg.sender_id;
                    
                    const senderProfile = isMe 
                      ? { name: myProfile.name, avatar_url: myProfile.avatar_url, email: user.email }
                      : { name: contacts.get(msg.sender_id)?.name, avatar_url: contacts.get(msg.sender_id)?.avatar_url, email: msg.sender_email };

                    return (
                      <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'} w-full animate-in fade-in zoom-in-95 duration-200 mt-0.5`}>
                        {!sameSenderAsPrev && (
                          <div className={`flex items-center gap-2 mb-1 mt-4 px-1 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                            <div className="w-6 h-6 rounded-full bg-neutral-800 flex items-center justify-center overflow-hidden text-[10px] font-bold text-white shrink-0 ring-1 ring-neutral-700/50 shadow-sm">
                              {senderProfile.avatar_url ? (
                                <img src={senderProfile.avatar_url} className="w-full h-full object-cover" />
                              ) : (
                                (senderProfile.name || senderProfile.email).charAt(0).toUpperCase()
                              )}
                            </div>
                            <span className="text-xs text-neutral-500 font-medium tracking-wide">
                              {senderProfile.name || senderProfile.email.split('@')[0]}
                            </span>
                          </div>
                        )}
                        <div 
                          className={`relative max-w-[85%] sm:max-w-[70%] shadow-xl leading-relaxed break-words whitespace-pre-wrap group/msgbubble transition-all select-none sm:select-text ${
                            isMe 
                              ? 'text-white rounded-[20px] rounded-tr-[4px]' 
                              : 'bg-neutral-800 text-neutral-100 rounded-[20px] rounded-tl-[4px] border border-neutral-700/30 backdrop-blur-md'
                          } ${sameSenderAsPrev ? 'mt-0.5' : 'mt-0'} overflow-visible`}
                          style={isMe ? { backgroundColor: myProfile.chat_bubble_color } : {}}
                          onTouchStart={() => handleTouchStart(msg.id)}
                          onTouchEnd={handleTouchEnd}
                          onTouchMove={handleTouchEnd}
                        >
                          {/* Laptop Hover Action (Chevron) */}
                          <div className={`absolute top-1 ${isMe ? 'right-2' : 'left-2'} opacity-0 group-hover/msgbubble:opacity-100 transition-opacity z-10 hidden sm:block`}>
                            <button 
                              onClick={() => setMsgMenuOpen(msgMenuOpen === msg.id ? null : msg.id)}
                              className="p-1.5 bg-neutral-900/80 hover:bg-neutral-800 backdrop-blur-sm shadow-md rounded-full text-neutral-300 pointer-events-auto"
                            >
                              <ChevronDown className="w-3.5 h-3.5" />
                            </button>
                            
                            {/* Message Menu */}
                            {msgMenuOpen === msg.id && (
                              <>
                                <div className="fixed inset-0 z-[60]" onClick={(e) => { e.stopPropagation(); setMsgMenuOpen(null); }} />
                                <div className={`absolute top-full mt-1 ${isMe ? 'right-0' : 'left-0'} w-48 bg-neutral-900 border border-neutral-800 rounded-xl shadow-2xl z-[70] overflow-hidden animate-in fade-in zoom-in-95`}>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleDeleteMessage(msg.id, false, isMe); }}
                                    className={`w-full px-4 py-3 text-sm font-medium text-neutral-300 hover:text-white hover:bg-neutral-800 flex items-center justify-between transition-colors text-left ${isMe ? 'border-b border-neutral-800/50' : ''}`}
                                  >
                                    Delete for me
                                    <Trash2 className="w-4 h-4 opacity-70" />
                                  </button>
                                  {isMe && (
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleDeleteMessage(msg.id, true, isMe); }}
                                      className="w-full px-4 py-3 text-sm font-medium text-red-500 hover:text-red-400 hover:bg-neutral-800 flex items-center justify-between transition-colors text-left"
                                    >
                                      Delete for everyone
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  )}
                                </div>
                              </>
                            )}
                          </div>

                          {/* Mobile Action triggers automatically via 2-sec touch */}
                          {msgMenuOpen === msg.id && (
                            <div className="sm:hidden fixed inset-0 z-[100] flex flex-col justify-end pointer-events-none pb-8 px-4">
                              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-[65] pointer-events-auto animate-in fade-in" onClick={(e) => { e.stopPropagation(); setMsgMenuOpen(null); }} />
                              <div className="relative w-full bg-neutral-900 border border-neutral-700 rounded-3xl shadow-2xl z-[70] p-1.5 animate-in slide-in-from-bottom-4 pointer-events-auto">
                                 <button
                                    onClick={(e) => { e.stopPropagation(); handleDeleteMessage(msg.id, false, isMe); }}
                                    className={`w-full px-5 py-4 font-bold text-neutral-300 hover:bg-neutral-800 rounded-t-[20px] flex items-center justify-between text-left ${isMe ? 'border-b border-neutral-800/80' : ''}`}
                                 >
                                    Delete for me
                                    <Trash2 className="w-5 h-5 opacity-70" />
                                 </button>
                                 {isMe && (
                                   <button
                                      onClick={(e) => { e.stopPropagation(); handleDeleteMessage(msg.id, true, isMe); }}
                                      className="w-full px-5 py-4 font-bold text-red-500 hover:bg-neutral-800 rounded-b-[20px] flex items-center justify-between text-left"
                                   >
                                      Delete for everyone
                                      <Trash2 className="w-5 h-5" />
                                   </button>
                                 )}
                              </div>
                              <div className="relative w-full bg-neutral-900 border border-neutral-700 rounded-3xl shadow-2xl z-[70] p-1.5 mt-2 animate-in slide-in-from-bottom-2 pointer-events-auto">
                                 <button onClick={(e) => { e.stopPropagation(); setMsgMenuOpen(null); }} className="w-full px-5 py-3.5 font-bold text-neutral-400 hover:bg-neutral-800 rounded-[20px] flex items-center justify-center">Cancel</button>
                              </div>
                            </div>
                          )}

                          <div className={msg.image_url ? "" : "px-4 pt-2.5"}>
                            {msg.image_url && (
                               <div className="p-1">
                                 <img 
                                   src={msg.image_url} 
                                   alt="Shared" 
                                   className="rounded-[16px] max-h-80 w-full object-cover cursor-pointer hover:opacity-95 transition-opacity" 
                                   onClick={() => window.open(msg.image_url, '_blank')}
                                 />
                               </div>
                            )}
                            {msg.text && (
                                <p className="text-[15px]">{msg.text}</p>
                            )}
                          </div>
                          <div className={`text-[10px] pb-1.5 pr-3 text-right font-medium opacity-60 ${!msg.text && !msg.image_url ? '-mt-6' : ''}`}>
                            {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} className="h-4" />
              </div>
            </div>

            {/* Input Overlay */}
            <div className="w-full shrink-0 z-20 sticky bottom-0 border-t border-neutral-800/50 bg-[#0B0F19]/95 backdrop-blur-2xl p-4 sm:p-5">
              <form onSubmit={handleSend} className="relative flex items-center gap-3 w-full max-w-5xl mx-auto">
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  accept="image/*" 
                  onChange={handleImageUpload} 
                />
                
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setShowEmojiPicker(!showEmojiPicker)}
                    className={`p-2 rounded-xl transition-colors ${showEmojiPicker ? 'bg-indigo-600/20 text-indigo-400' : 'text-neutral-400 hover:text-white hover:bg-neutral-800'}`}
                  >
                    <Smile className="w-6 h-6" />
                  </button>
                  <button
                    type="button"
                    title="Change background color"
                    onClick={() => {
                      const newColor = myProfile.chat_background_color === '#0b0f19' ? '#1a1c2e' : '#0b0f19';
                      setMyProfile(prev => ({ ...prev, chat_background_color: newColor }));
                      
                      // Save directly to backend
                      insforge.database.from('profiles').update({ chat_background_color: newColor }).eq('id', user.id);
                      if (insforge.realtime.isConnected) {
                        insforge.realtime.publish('chat:room-1', 'profile_update', { id: user.id, chat_background_color: newColor });
                      }
                    }}
                    className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-xl transition-colors"
                  >
                    <Palette className="w-6 h-6" />
                  </button>
                  <button
                    type="button"
                    disabled={isUploading}
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-xl transition-colors disabled:opacity-50"
                  >
                    {isUploading ? <Loader2 className="w-6 h-6 animate-spin" /> : <ImageIcon className="w-6 h-6" />}
                  </button>
                </div>

                {showEmojiPicker && (
                  <div className="absolute bottom-full left-0 mb-4 p-2 bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl flex flex-wrap gap-1 w-64 z-50 animate-in fade-in slide-in-from-bottom-2">
                    {commonEmojis.map(emoji => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => addEmoji(emoji)}
                        className="w-10 h-10 flex items-center justify-center hover:bg-neutral-800 rounded-lg transition-colors text-xl"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}

                <div className="flex-1 bg-neutral-900 border border-neutral-800 hover:border-neutral-700 text-neutral-100 rounded-2xl transition-all shadow-inner focus-within:ring-2 focus-within:ring-indigo-500/40 focus-within:border-indigo-500">
                  <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => {
                      setNewMessage(e.target.value);
                      handleTyping();
                    }}
                    onFocus={() => setShowEmojiPicker(false)}
                    placeholder="Type a message..."
                    className="w-full bg-transparent outline-none py-4 px-6 block rounded-2xl m-0 placeholder:text-neutral-600 text-[15px] font-medium"
                  />
                </div>
                <button 
                  type="submit"
                  disabled={!newMessage.trim() && !isUploading}
                  className="w-14 h-14 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-0 disabled:w-0 disabled:p-0 transition-all duration-300 text-white rounded-2xl flex items-center justify-center shrink-0 shadow-[0_10px_20px_-10px_rgba(79,70,229,0.5)] active:scale-95 active:shadow-none"
                >
                  <Send className="w-6 h-6" />
                </button>
              </form>
            </div>
          </>
        )}
      </div>
      
      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-neutral-900 border border-neutral-800 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl animate-in zoom-in-95 duration-300">
            <div className="p-6 border-b border-neutral-800 flex justify-between items-center bg-neutral-900/50">
              <h3 className="text-xl font-bold flex items-center gap-2">
                <User className="text-indigo-500" />
                Profile Settings
              </h3>
              <button 
                onClick={() => setShowSettings(false)}
                className="p-2 hover:bg-neutral-800 rounded-xl transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <form onSubmit={handleProfileUpdate} className="p-6 space-y-6 max-h-[70vh] overflow-y-auto scrollbar-hide">
              <div className="flex flex-col items-center gap-4 py-4">
                <div className="relative group">
                  <div className="w-24 h-24 rounded-full bg-neutral-800 flex items-center justify-center overflow-hidden border-4 border-indigo-600/30">
                    {draftProfile.avatar_url ? (
                      <img src={draftProfile.avatar_url} className="w-full h-full object-cover" />
                    ) : (
                      <span className="text-4xl font-bold">{user.email[0].toUpperCase()}</span>
                    )}
                  </div>
                  <button 
                    type="button"
                    onClick={() => profileImageInputRef.current?.click()}
                    className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center rounded-full"
                  >
                    <ImageIcon className="text-white w-6 h-6" />
                  </button>
                  <input 
                    type="file" 
                    ref={profileImageInputRef} 
                    className="hidden" 
                    onChange={handleAvatarUpload} 
                    accept="image/*" 
                  />
                </div>
                <p className="text-xs text-neutral-500 font-medium uppercase tracking-wider">Profile Picture</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-bold text-neutral-400 mb-1.5 ml-1">Display Name</label>
                  <input 
                    type="text" 
                    value={draftProfile.name}
                    onChange={e => setDraftProfile(prev => ({ ...prev, name: e.target.value }))}
                    placeholder="Set your display name..."
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-2xl py-3 px-5 outline-none focus:border-indigo-500 transition-all font-medium"
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-neutral-400 mb-1.5 ml-1">About / Bio</label>
                  <textarea 
                    value={draftProfile.bio}
                    onChange={e => setDraftProfile(prev => ({ ...prev, bio: e.target.value }))}
                    placeholder="Tell us something about yourself..."
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-2xl py-3 px-5 outline-none focus:border-indigo-500 transition-all min-h-[100px] resize-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-neutral-400 mb-1.5 ml-1">Bubble Color</label>
                    <div className="flex items-center gap-3 bg-neutral-950 p-2 rounded-2xl border border-neutral-800">
                      <input 
                        type="color" 
                        value={draftProfile.chat_bubble_color}
                        onChange={e => setDraftProfile(prev => ({ ...prev, chat_bubble_color: e.target.value }))}
                        className="w-10 h-10 rounded-xl bg-transparent border-none cursor-pointer"
                      />
                      <span className="text-xs font-mono">{draftProfile.chat_bubble_color}</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-neutral-400 mb-1.5 ml-1">BG Color</label>
                    <div className="flex items-center gap-3 bg-neutral-950 p-2 rounded-2xl border border-neutral-800">
                      <input 
                        type="color" 
                        value={draftProfile.chat_background_color}
                        onChange={e => setDraftProfile(prev => ({ ...prev, chat_background_color: e.target.value }))}
                        className="w-10 h-10 rounded-xl bg-transparent border-none cursor-pointer"
                      />
                      <span className="text-xs font-mono">{draftProfile.chat_background_color}</span>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="flex items-center justify-between text-sm font-bold text-neutral-400 mb-1.5 ml-1">
                    Chat Background Image
                    {draftProfile.chat_background_image && (
                      <button type="button" onClick={() => setDraftProfile(prev => ({...prev, chat_background_image: ''}))} className="text-red-400 text-[11px] font-bold uppercase tracking-wider hover:text-red-300 transition-colors px-2 py-0.5 bg-red-400/10 rounded-lg">
                        Remove
                      </button>
                    )}
                  </label>
                  <div 
                    onClick={() => bgImageInputRef.current?.click()}
                    className="w-full h-[120px] rounded-2xl border-2 border-dashed border-neutral-800 hover:border-indigo-500/50 hover:bg-neutral-900/50 transition-all cursor-pointer flex items-center justify-center overflow-hidden bg-neutral-950 relative group"
                  >
                    <input 
                      type="file" 
                      ref={bgImageInputRef} 
                      className="hidden" 
                      accept="image/*" 
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setIsSaving(true);
                        try {
                          const { data } = await insforge.storage.from('chat-attachments').uploadAuto(file);
                          if (data?.url) setDraftProfile(prev => ({ ...prev, chat_background_image: data.url }));
                        } finally {
                          setIsSaving(false);
                        }
                      }} 
                    />
                    {draftProfile.chat_background_image ? (
                      <img src={draftProfile.chat_background_image} className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity" />
                    ) : (
                      <div className="flex flex-col items-center gap-2 text-neutral-500 group-hover:text-indigo-400 transition-colors">
                        <ImageIcon className="w-6 h-6" />
                        <span className="text-xs font-medium">Click to upload background image</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <button 
                type="submit"
                disabled={isSaving}
                className="w-full bg-indigo-600 hover:bg-indigo-500 py-4 rounded-2xl font-bold text-white shadow-xl shadow-indigo-600/20 active:scale-[0.98] transition-all disabled:opacity-50"
              >
                {isSaving ? 'Saving Changes...' : 'Save Profile'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
