import { useEffect, useState, useRef, FormEvent } from 'react';
import { insforge } from '../lib/insforge';
import { Send, UserCircle2, MessageSquareOff, ChevronLeft, Image as ImageIcon, Smile, Loader2, Settings, User, Palette, X, Trash2, Pin, Users, MoreVertical, Plus } from 'lucide-react';

interface DirectMessage {
  id: string;
  sender_id: string;
  sender_email: string;
  receiver_id?: string;
  receiver_email?: string;
  text: string | null;
  image_url?: string;
  client_id?: string;
  created_at: string;
  deleted_for_everyone?: boolean;
  deleted_for_sender?: boolean;
  deleted_for_receiver?: boolean;
  is_pinned?: boolean;
  group_id?: string; // If it's a group message it goes to group_messages
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

interface Group {
  id: string;
  name: string;
  description?: string;
  avatar_url?: string;
  created_by: string;
}

interface ChatProps {
  user: any;
}

export default function Chat({ user }: ChatProps) {
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  
  const [contacts, setContacts] = useState<Map<string, UserProfile>>(new Map());
  const [groups, setGroups] = useState<Group[]>([]);
  const [activeChat, setActiveChat] = useState<{ type: 'dm' | 'group', id: string } | null>(null);
  
  const [isUploading, setIsUploading] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [msgMenuOpen, setMsgMenuOpen] = useState<string | null>(null);

  const [myProfile, setMyProfile] = useState({
    name: '',
    bio: '',
    avatar_url: '',
    chat_bubble_color: '#4f46e5',
    chat_background_color: '#0b0f19',
    chat_background_image: ''
  });
  const [draftProfile, setDraftProfile] = useState({ ...myProfile });
  const [isSaving, setIsSaving] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const profileImageInputRef = useRef<HTMLInputElement>(null);
  const bgImageInputRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const fetchMyProfile = async () => {
      const { data } = await insforge.database.from('profiles').select('*').eq('id', user.id).single();
      if (data) {
        const profileData = {
          name: data.name || '',
          bio: data.bio || '',
          avatar_url: data.avatar_url || '',
          chat_bubble_color: data.chat_bubble_color || '#4f46e5',
          chat_background_color: data.chat_background_color || '#0b0f19',
          chat_background_image: data.chat_background_image || ''
        };
        setMyProfile(profileData);
        setDraftProfile(profileData);
      }
    };
    fetchMyProfile();
  }, [user.id]);

  useEffect(() => {
    const fetchUsersAndGroups = async () => {
      const { data: userData } = await insforge.database.from('profiles').select('id, email, name, avatar_url');
      if (userData) {
        const loadedContacts = new Map<string, UserProfile>();
        userData.forEach((p: any) => {
          if (p.id !== user.id) {
            loadedContacts.set(p.id, { id: p.id, email: p.email, name: p.name, avatar_url: p.avatar_url, isOnline: false });
          }
        });
        setContacts(loadedContacts);
      }
      const { data: groupData } = await insforge.database
        .from('group_members')
        .select(`group_id, groups(*)`)
        .eq('user_id', user.id);
      if (groupData) {
        setGroups(groupData.map((g: any) => g.groups));
      }
    };
    fetchUsersAndGroups();
  }, [user.id]);

  useEffect(() => {
    if (!user || !activeChat) return;
    const fetchHistory = async () => {
      if (activeChat.type === 'dm') {
        const { data } = await insforge.database
          .from('messages')
          .select('*')
          .or(`and(sender_id.eq.${user.id},receiver_id.eq.${activeChat.id}),and(sender_id.eq.${activeChat.id},receiver_id.eq.${user.id})`)
          .order('created_at', { ascending: false })
          .limit(50);
        if (data) setMessages((data as DirectMessage[]).reverse());
      } else {
        const { data } = await insforge.database
          .from('group_messages')
          .select('*')
          .eq('group_id', activeChat.id)
          .order('created_at', { ascending: false })
          .limit(50);
        if (data) setMessages((data as DirectMessage[]).reverse());
      }
    };
    fetchHistory();
  }, [activeChat, user]);

  useEffect(() => {
    if (!user) return;
    let cleanupInterval: ReturnType<typeof setInterval>;
    
    const connectRealtime = async () => {
      await insforge.realtime.connect();
      const { ok } = await insforge.realtime.subscribe('chat:room-1');
      if (ok) {
        insforge.realtime.on('new_message', (payload: any) => {
          const msg = (payload.payload || payload) as DirectMessage;
          if (!msg.sender_id) return;

          const isGroupMessage = !!msg.group_id;
          const isRelevant = activeChat && (
            (isGroupMessage && activeChat.type === 'group' && msg.group_id === activeChat.id) ||
            (!isGroupMessage && activeChat.type === 'dm' && ((msg.sender_id === user.id && msg.receiver_id === activeChat.id) || (msg.sender_id === activeChat.id && msg.receiver_id === user.id)))
          );

          if (isRelevant) {
            setMessages(prev => {
              if (prev.find(m => m.id === msg.id || (msg.client_id && m.client_id === msg.client_id))) {
                return prev.map(m => (m.id === msg.id || m.client_id === msg.client_id) ? msg : m);
              }
              return [...prev, msg];
            });
          }
        });

        insforge.realtime.on('message_action', (payload: any) => {
          const action = payload.payload || payload;
          setMessages(prev => prev.map(m => {
            if (m.id === action.message_id) {
              if (action.type === 'delete_everyone') return { ...m, deleted_for_everyone: true };
              if (action.type === 'delete_sender') return { ...m, deleted_for_sender: true };
              if (action.type === 'delete_receiver') return { ...m, deleted_for_receiver: true };
              if (action.type === 'pin') return { ...m, is_pinned: action.is_pinned };
            }
            return m;
          }));
        });

        insforge.realtime.on('presence:ping', (payload: any) => {
          if (!payload.user_id || payload.user_id === user.id) return;
          setContacts(prev => {
            const next = new Map(prev);
            const ex = next.get(payload.user_id);
            if (ex) {
              next.set(payload.user_id, { ...ex, isOnline: true, lastSeen: Date.now() });
            }
            return next;
          });
        });

        cleanupInterval = setInterval(() => {
          if (insforge.realtime.isConnected) insforge.realtime.publish('chat:room-1', 'presence:ping', { user_id: user.id });
        }, 5000);
      }
    };
    connectRealtime();
    return () => {
      if (cleanupInterval) clearInterval(cleanupInterval);
      insforge.realtime.unsubscribe('chat:room-1');
    };
  }, [user, activeChat]);

  const handleSend = async (e?: FormEvent, textContent?: string, imageUrl?: string) => {
    e?.preventDefault();
    if ((!newMessage.trim() && !textContent && !imageUrl) || !user || !activeChat) return;

    const text = textContent || newMessage.trim() || null;
    if (!textContent) setNewMessage('');

    const tempId = crypto.randomUUID();
    const tempMsg: DirectMessage = {
      id: tempId,
      sender_id: user.id,
      sender_email: user.email,
      text,
      image_url: imageUrl,
      created_at: new Date().toISOString(),
      client_id: tempId
    };

    if (activeChat.type === 'group') {
      tempMsg.group_id = activeChat.id;
      setMessages(prev => [...prev, tempMsg]);
      insforge.database.from('group_messages').insert([{
        group_id: activeChat.id, sender_id: user.id, sender_email: user.email, text, image_url: imageUrl, client_id: tempId
      }]).then(({ data }) => {
        if (data) {
          insforge.realtime.publish('chat:room-1', 'new_message', data[0]);
        }
      });
    } else {
      tempMsg.receiver_id = activeChat.id;
      tempMsg.receiver_email = contacts.get(activeChat.id)?.email || '';
      setMessages(prev => [...prev, tempMsg]);
      insforge.database.from('messages').insert([{
        sender_id: user.id, sender_email: user.email, receiver_id: activeChat.id, receiver_email: tempMsg.receiver_email, text, image_url: imageUrl, client_id: tempId
      }]).then(({ data }) => {
        if (data) {
          insforge.realtime.publish('chat:room-1', 'new_message', data[0]);
        }
      });
    }
  };

  const handleAction = async (msgId: string, actionType: 'delete_everyone' | 'delete_me' | 'pin', currentPin?: boolean) => {
    const table = activeChat?.type === 'group' ? 'group_messages' : 'messages';
    const msg = messages.find(m => m.id === msgId);
    if (!msg) return;

    if (actionType === 'delete_everyone') {
      await insforge.database.from(table).update({ deleted_for_everyone: true }).eq('id', msgId);
      insforge.realtime.publish('chat:room-1', 'message_action', { message_id: msgId, type: 'delete_everyone' });
    } else if (actionType === 'delete_me') {
      const isSender = msg.sender_id === user.id;
      const column = isSender ? 'deleted_for_sender' : 'deleted_for_receiver';
      if (table === 'messages') {
        await insforge.database.from(table).update({ [column]: true }).eq('id', msgId);
      } else {
         // for groups we just simplify by not showing it locally, db-level group personal delete needs more complex many-to-many. For now just delete for everyone if we allow it
      }
      insforge.realtime.publish('chat:room-1', 'message_action', { message_id: msgId, type: isSender ? 'delete_sender' : 'delete_receiver' });
    } else if (actionType === 'pin') {
      await insforge.database.from(table).update({ is_pinned: !currentPin }).eq('id', msgId);
      insforge.realtime.publish('chat:room-1', 'message_action', { message_id: msgId, type: 'pin', is_pinned: !currentPin });
    }
    setMsgMenuOpen(null);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, isBg: boolean = false) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    const { data } = await insforge.storage.from('chat-attachments').uploadAuto(file);
    setIsUploading(false);
    
    if (data?.url) {
      if (isBg) {
        setDraftProfile(prev => ({ ...prev, chat_background_image: data.url }));
      } else {
        handleSend(undefined, undefined, data.url);
      }
    }
    if (e.target) e.target.value = '';
  };

  const createGroup = async (e: FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    const { data: group } = await insforge.database.from('groups').insert([{ name: newGroupName, created_by: user.id }]).select().single();
    if (group) {
      await insforge.database.from('group_members').insert([{ group_id: group.id, user_id: user.id, user_email: user.email }]);
      setGroups(prev => [...prev, group]);
      setActiveChat({ type: 'group', id: group.id });
    }
    setShowCreateGroup(false);
    setNewGroupName('');
  };

  const handleProfileUpdate = async (e: FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    await insforge.database.from('profiles').update(draftProfile).eq('id', user.id);
    setIsSaving(false);
    setMyProfile(draftProfile);
    setShowSettings(false);
  };

  const visibleMessages = messages.filter(msg => {
    if (msg.deleted_for_everyone) return false;
    if (activeChat?.type === 'dm') {
      if (msg.sender_id === user.id && msg.deleted_for_sender) return false;
      if (msg.sender_id !== user.id && msg.deleted_for_receiver) return false;
    }
    return true;
  });

  const pinnedMessages = visibleMessages.filter(m => m.is_pinned);

  const activeTitle = activeChat?.type === 'group' 
    ? groups.find(g => g.id === activeChat.id)?.name 
    : contacts.get(activeChat?.id || '')?.name || contacts.get(activeChat?.id || '')?.email?.split('@')[0] || '';

  const activeAvatar = activeChat?.type === 'group'
    ? groups.find(g => g.id === activeChat.id)?.avatar_url
    : contacts.get(activeChat?.id || '')?.avatar_url;

  return (
    <div className="flex flex-col sm:flex-row h-full w-full bg-[#0B0F19] overflow-hidden relative">
      <div className={`sm:border-r border-neutral-800 bg-neutral-950 flex flex-col shrink-0 w-full sm:w-[360px] ${activeChat ? 'hidden sm:flex' : 'flex'}`}>
        <div className="p-5 border-b border-neutral-800 flex justify-between items-center">
          <h2 className="text-xl font-bold text-white">Inbox</h2>
          <div className="flex items-center gap-1">
            <button onClick={() => setShowCreateGroup(true)} className="p-2 hover:bg-neutral-800 rounded-lg text-neutral-400">
              <Plus className="w-5 h-5" />
            </button>
            <button onClick={() => setShowSettings(true)} className="p-2 hover:bg-neutral-800 rounded-lg text-neutral-400">
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto scrollbar-hide py-2">
          {groups.length > 0 && <div className="px-4 py-2 text-xs font-bold text-neutral-500 uppercase">Groups</div>}
          {groups.map(group => (
            <button
              key={group.id}
              onClick={() => setActiveChat({ type: 'group', id: group.id })}
              className={`w-full flex items-center gap-3 px-4 py-4 hover:bg-neutral-900/50 ${activeChat?.id === group.id ? 'bg-indigo-600/10' : ''}`}
            >
              <div className="w-12 h-12 rounded-full bg-neutral-800 flex items-center justify-center text-white"><Users className="w-5 h-5" /></div>
              <div className="flex-1 text-left font-bold text-[15px] truncate">{group.name}</div>
            </button>
          ))}
          
          <div className="px-4 py-2 mt-2 text-xs font-bold text-neutral-500 uppercase">Direct Messages</div>
          {Array.from(contacts.values()).map(contact => (
            <button
              key={contact.id}
              onClick={() => setActiveChat({ type: 'dm', id: contact.id })}
              className={`w-full flex items-center gap-3 px-4 py-4 hover:bg-neutral-900/50 ${activeChat?.id === contact.id ? 'bg-indigo-600/10' : ''}`}
            >
              <div className="relative w-12 h-12 rounded-full bg-neutral-800 flex items-center justify-center text-white">
                {contact.avatar_url ? <img src={contact.avatar_url} className="rounded-full w-full h-full object-cover" /> : contact.email[0].toUpperCase()}
                {contact.isOnline && <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-neutral-950" />}
              </div>
              <div className="flex-1 text-left">
                <div className="font-bold text-[15px]">{contact.name || contact.email.split('@')[0]}</div>
                <div className="text-xs text-neutral-500">{contact.isOnline ? 'Online' : 'Offline'}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div 
        className={`flex-1 flex flex-col relative w-full overflow-hidden ${!activeChat ? 'hidden sm:flex' : 'flex'}`} 
        style={{ 
          backgroundColor: myProfile.chat_background_color,
          backgroundImage: myProfile.chat_background_image ? `url(${myProfile.chat_background_image})` : 'none',
          backgroundSize: 'cover',
          backgroundPosition: 'center'
        }}
      >
        {!activeChat ? (
          <div className="flex-1 flex flex-col items-center justify-center text-neutral-500 bg-black/60 backdrop-blur-sm">
            <MessageSquareOff className="w-16 h-16 text-neutral-700/50 mb-4" />
            <p className="text-neutral-400">Select a chat to start messaging</p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-4 px-4 sm:px-6 py-4 border-b border-neutral-800/50 bg-[#0B0F19]/90 backdrop-blur-xl shrink-0 z-20">
              <button onClick={() => setActiveChat(null)} className="sm:hidden p-2 -ml-2 text-neutral-400"><ChevronLeft className="w-6 h-6" /></button>
              <div className="w-10 h-10 rounded-full bg-neutral-800 flex items-center justify-center text-white overflow-hidden">
                {activeAvatar ? <img src={activeAvatar} className="w-full h-full object-cover" /> : <Users className="w-5 h-5"/>}
              </div>
              <h3 className="text-lg font-bold text-white shrink-0">{activeTitle}</h3>
              {activeChat.type === 'dm' && contacts.get(activeChat.id)?.isOnline && (
                 <span className="text-xs font-bold text-green-500 ml-2">Online</span>
              )}
            </div>

            {pinnedMessages.length > 0 && (
              <div className="bg-neutral-900/90 border-b border-neutral-800 p-3 flex flex-col gap-2 z-10 backdrop-blur-sm">
                <div className="text-xs font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-1"><Pin className="w-3 h-3"/> Pinned Messages</div>
                {pinnedMessages.map(m => (
                  <div key={'pin-'+m.id} className="text-sm text-neutral-200 truncate border-l-2 border-indigo-500 pl-2 bg-neutral-800/50 p-1.5 rounded pr-2">
                    <span className="font-bold mr-2 text-neutral-400">{m.sender_email.split('@')[0]}:</span>
                    {m.text || 'Image'}
                  </div>
                ))}
              </div>
            )}

            <div className={`flex-1 overflow-y-auto p-4 sm:p-6 pb-20 scrollbar-hide flex flex-col min-h-full justify-end ${myProfile.chat_background_image ? 'bg-black/60 backdrop-blur-sm' : ''}`}>
              {visibleMessages.map((msg, idx) => {
                const isMe = msg.sender_id === user.id;
                const senderProfile = isMe ? myProfile : contacts.get(msg.sender_id);
                const prevSender = idx > 0 ? visibleMessages[idx-1].sender_id : null;
                const showHeader = prevSender !== msg.sender_id;

                return (
                  <div key={msg.id} className={`flex flex-col relative group ${isMe ? 'items-end' : 'items-start'} mt-${showHeader ? '4' : '1'} `}>
                    {showHeader && activeChat.type === 'group' && !isMe && (
                      <span className="text-xs text-neutral-400 font-bold mb-1 ml-2">{senderProfile?.name || msg.sender_email.split('@')[0]}</span>
                    )}
                    
                    <div className="flex items-center gap-2 group/msg relative max-w-[85%] sm:max-w-[70%]">
                      {isMe && (
                        <button onClick={() => setMsgMenuOpen(msgMenuOpen === msg.id ? null : msg.id)} className="opacity-0 group-hover/msg:opacity-100 p-1 hover:bg-neutral-800 rounded-full text-neutral-400">
                          <MoreVertical className="w-4 h-4"/>
                        </button>
                      )}
                      
                      <div className={`relative px-4 py-2.5 rounded-[20px] shadow-xl ${isMe ? 'text-white rounded-tr-sm' : 'bg-neutral-800 text-neutral-100 rounded-tl-sm'}`} style={isMe ? { backgroundColor: myProfile.chat_bubble_color } : {}}>
                        {msg.is_pinned && <Pin className="w-3 h-3 absolute -top-1 -right-1 text-indigo-400" />}
                        {msg.image_url && <img src={msg.image_url} className="rounded-xl w-60 object-cover mb-2" onClick={() => window.open(msg.image_url, '_blank')} />}
                        {msg.text && <p className="text-[15px] whitespace-pre-wrap">{msg.text}</p>}
                        <div className="text-[10px] text-right font-medium opacity-60 mt-1">{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                      </div>

                      {!isMe && (
                        <button onClick={() => setMsgMenuOpen(msgMenuOpen === msg.id ? null : msg.id)} className="opacity-0 group-hover/msg:opacity-100 p-1 hover:bg-neutral-800 rounded-full text-neutral-400">
                          <MoreVertical className="w-4 h-4"/>
                        </button>
                      )}

                      {msgMenuOpen === msg.id && (
                        <div className={`absolute top-0 ${isMe ? 'right-full mr-2' : 'left-full ml-2'} z-50 bg-neutral-900 border border-neutral-700 rounded-xl shadow-2xl p-1 min-w-[160px]`}>
                          <button onClick={() => handleAction(msg.id, 'pin', msg.is_pinned)} className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-800 rounded-lg flex items-center gap-2 text-neutral-200"><Pin className="w-4 h-4" /> {msg.is_pinned ? 'Unpin' : 'Pin'}</button>
                          <button onClick={() => handleAction(msg.id, 'delete_me')} className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-800 rounded-lg flex items-center gap-2 text-neutral-200"><Trash2 className="w-4 h-4" /> Delete for Me</button>
                          {isMe && <button onClick={() => handleAction(msg.id, 'delete_everyone')} className="w-full text-left px-3 py-2 text-sm hover:bg-neutral-800 rounded-lg flex items-center gap-2 text-red-400 font-medium"><Trash2 className="w-4 h-4" /> Delete for Everyone</button>}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} className="h-4" />
            </div>

            <div className="w-full z-20 sticky bottom-0 border-t border-neutral-800/50 bg-[#0B0F19]/95 backdrop-blur-xl p-4 sm:p-5">
              <form onSubmit={handleSend} className="flex items-center gap-3 w-full max-w-5xl mx-auto">
                <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={(e) => handleImageUpload(e)} />
                <button type="button" onClick={() => setShowEmojiPicker(!showEmojiPicker)} className="text-neutral-400 hover:text-white"><Smile className="w-6 h-6" /></button>
                <button type="button" disabled={isUploading} onClick={() => fileInputRef.current?.click()} className="text-neutral-400 hover:text-white">{isUploading ? <Loader2 className="w-6 h-6 animate-spin"/> : <ImageIcon className="w-6 h-6"/>}</button>
                <div className="flex-1 bg-neutral-900 border border-neutral-800 rounded-2xl flex items-center px-4 py-1">
                  <input type="text" value={newMessage} onChange={(e) => setNewMessage(e.target.value)} placeholder="Message..." className="w-full bg-transparent outline-none py-2 text-[15px] font-medium text-white" />
                </div>
                <button type="submit" disabled={!newMessage.trim() && !isUploading} className="w-12 h-12 bg-indigo-600 disabled:opacity-50 text-white rounded-2xl flex items-center justify-center shrink-0 shadow-lg"><Send className="w-5 h-5" /></button>
              </form>
            </div>
          </>
        )}
      </div>

      {showSettings && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 relative backdrop-blur-sm">
          <div className="bg-neutral-900 border border-neutral-800 rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-5 border-b border-neutral-800 flex justify-between items-center"><h3 className="text-xl font-bold flex items-center gap-2"><User className="text-indigo-400"/> Settings</h3><button onClick={() => setShowSettings(false)} className="text-neutral-400" ><X/></button></div>
            <form onSubmit={handleProfileUpdate} className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
               <div className="space-y-4">
                 <div>
                   <label className="text-sm font-bold text-neutral-400 block mb-2">Display Name</label>
                   <input type="text" value={draftProfile.name} onChange={e => setDraftProfile(prev => ({ ...prev, name: e.target.value }))} className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 outline-none focus:border-indigo-500" />
                 </div>
                 <div className="grid grid-cols-2 gap-4">
                   <div>
                     <label className="text-sm font-bold text-neutral-400 block mb-2">Bubble Color</label>
                     <input type="color" value={draftProfile.chat_bubble_color} onChange={e => setDraftProfile(prev => ({ ...prev, chat_bubble_color: e.target.value }))} className="w-full h-12 rounded-xl" />
                   </div>
                   <div>
                     <label className="text-sm font-bold text-neutral-400 block mb-2">BG Color</label>
                     <input type="color" value={draftProfile.chat_background_color} onChange={e => setDraftProfile(prev => ({ ...prev, chat_background_color: e.target.value }))} className="w-full h-12 rounded-xl" />
                   </div>
                 </div>
                 <div>
                   <label className="text-sm font-bold text-neutral-400 block mb-2 flex items-center justify-between">
                     Chat Background Image 
                     {draftProfile.chat_background_image && <button type="button" onClick={() => setDraftProfile(prev => ({...prev, chat_background_image: ''}))} className="text-red-400 text-xs hover:underline">Remove</button>}
                   </label>
                   <div 
                     onClick={() => bgImageInputRef.current?.click()} 
                     className="w-full h-32 border-2 border-dashed border-neutral-700 rounded-xl flex items-center justify-center cursor-pointer hover:border-indigo-500 transition-colors bg-neutral-950 overflow-hidden relative"
                   >
                     {draftProfile.chat_background_image ? (
                       <img src={draftProfile.chat_background_image} className="w-full h-full object-cover opacity-60 hover:opacity-100 transition-opacity" />
                     ) : (
                       <div className="flex flex-col items-center text-neutral-500"><ImageIcon className="w-6 h-6 mb-2"/><span>Click to upload image</span></div>
                     )}
                   </div>
                   <input type="file" ref={bgImageInputRef} className="hidden" accept="image/*" onChange={(e) => handleImageUpload(e, true)} />
                 </div>
               </div>
               <button type="submit" disabled={isSaving} className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 rounded-xl font-bold text-white shadow-xl">Save Changes</button>
            </form>
          </div>
        </div>
      )}

      {showCreateGroup && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 relative backdrop-blur-sm">
          <div className="bg-neutral-900 border border-neutral-800 rounded-3xl w-full max-w-sm shadow-2xl p-6">
            <h3 className="text-xl font-bold text-white mb-4">Create Group</h3>
            <form onSubmit={createGroup}>
              <input type="text" value={newGroupName} onChange={e => setNewGroupName(e.target.value)} placeholder="Group Name" className="w-full bg-neutral-950 border border-neutral-800 rounded-xl px-4 py-3 outline-none text-white focus:border-indigo-500 mb-4" />
              <div className="flex gap-3">
                <button type="button" onClick={() => setShowCreateGroup(false)} className="flex-1 py-3 bg-neutral-800 text-white rounded-xl font-bold hover:bg-neutral-700">Cancel</button>
                <button type="submit" className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-500">Create</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
