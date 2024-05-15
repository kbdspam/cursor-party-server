/*
TODO:

- track cursor position only within a provided element
- use msgpack
- provide a default room name from the href
*/
import * as React from "react";
import { useEffect, createContext } from "react";
import usePartySocket from "partysocket/react";
import { create } from "zustand";
import {
  type Presence,
  type User,
  type ClientMessage,
  type PartyMessage,
  decodeMessage,
  encodeClientMessage,
  encodeClientMessage2,
  encodeClientMessage3,
  partyMessageSchema,
} from "./presence-schema";

type UserMap = Map<string, User>;

type CurrentTimeout = {
  id: number,
};

type PresenceStoreType = {
  // The current user. The ID is the socket connection ID.
  // myself if set initially in a "sync" PartyMessage, and then
  // updated locally, optimistically. It is not updated remotely.
  myId: string | null;
  myself: User | null;
  setMyId: (myId: string) => void;

  // Flag to indicate whether a "sync" message has been received
  synced: boolean;
  setSynced: (synced: boolean) => void;

  // A local update to the presence of the current user,
  // ready to the sent to the server as an "update" ClientMessage
  pendingUpdate: Presence | null;
  clearPendingUpdate: () => void;

  pendingHeartbeat: boolean,
  setPendingHeartbeat: (v: boolean) => void;

  // Makes an optimistic local update of the presence of the current user,
  // and also queues an update to be sent to the server
  updatePresence: (partial: Partial<Presence>) => void;

  // Other users in the room. Set by an initial "sync" PartyMessage
  // and updated in "changes" messages.
  otherUsers: UserMap;

  // Used by the initial "sync" PartyMessage. Will replace both myself and otherUsers.
  setUsers: (users: UserMap) => void;

  // Used by the "changes" PartyMessage. Will update otherUsers but *not* myself.
  addUser: (id: string, user: User) => void;
  removeUser: (id: string) => void;
  updateUser: (id: string, presence: Presence) => void;

  currentTimeout: CurrentTimeout,
};

export const usePresence = create<PresenceStoreType>((set) => ({
  myId: null,
  myself: null,
  setMyId: (myId: string) => set({ myId: myId, myself: {presence: {}} }),

  synced: false,
  setSynced: (synced: boolean) => set({ synced }),

  pendingUpdate: null,
  clearPendingUpdate: () => set({ pendingUpdate: null }),

  pendingHeartbeat: false,
  setPendingHeartbeat: (v: boolean) => set({ pendingHeartbeat: v }),

  updatePresence: (partial: Partial<Presence>) =>
    set((state) => {
      // Optimistically update myself, and also set a pending update
      // Can only be used once myself has been set
      if (!state.myself) return {};
      const presence = {
        ...state.myself.presence,
        ...partial,
      } as Presence;
      const myself = {
        ...state.myself,
        presence,
      };
      return { myself, pendingUpdate: presence };
    }),

  otherUsers: new Map() as UserMap,

  setUsers: (users: UserMap) =>
    set((state) => {
      const otherUsers = new Map<string, User>();
      users.forEach((user, id) => {
        if (id === state.myId) return;
        otherUsers.set(id, user);
      });
      const myself = state.myId ? users.get(state.myId) : null;
      return { myself, otherUsers };
    }),

  addUser: (id: string, user: User) => {
    set((state) => {
      if (id === state.myId) {
        return {};
      }
      const otherUsers = new Map(state.otherUsers);
      otherUsers.set(id, user);
      return { otherUsers };
    });
  },
  removeUser: (id: string) => {
    set((state) => {
      if (id === state.myId) {
        return {};
      }
      const otherUsers = new Map(state.otherUsers);
      otherUsers.delete(id);
      return { otherUsers };
    });
  },
  updateUser: (id: string, presence: Presence) => {
    set((state) => {
      if (id === state.myId) {
        return {};
      }
      const otherUsers = new Map(state.otherUsers);
      const user = otherUsers.get(id);
      // if (!user) return { otherUsers };
      if (!user) {
        state.addUser(id, {} as User);
      };
      otherUsers.set(id, { ...user, presence });
      return { otherUsers };
    });
  },

  currentTimeout: {id: -1},
}));

export const PresenceContext = createContext({});

export default function PresenceProvider(props: {
  host: string;
  room: string;
  presence: Presence; // current user's initial presence, only name and color
  children: React.ReactNode;
}) {
  const {
    setMyId,
    setUsers,
    addUser,
    updateUser,
    removeUser,
    pendingUpdate,
    clearPendingUpdate,
    pendingHeartbeat,
    setPendingHeartbeat,
    synced,
    setSynced,
    currentTimeout,
  } = usePresence();

  const updateUsers = (message: PartyMessage) => {
    if (message.type !== "changes") return;
    if (message.add) {
      for (const [id, user] of Object.entries(message.add)) {
        addUser(id, user);
      }
    }
    if (message.presence) {
      for (const [id, presence] of Object.entries(message.presence)) {
        updateUser(id, presence);
      }
    }
    if (message.remove) {
      for (const id of message.remove) {
        removeUser(id);
      }
    }
  };

  const handleMessage = async (event: MessageEvent) => {
    if (event.data instanceof Blob) {
      const buffer = await event.data.arrayBuffer();
      let pos = 0;
      const u32 = new Uint32Array(buffer);
      const f32 = new Float32Array(buffer);
      while (pos < u32.length) {
        const type = u32[pos++];
        const count = u32[pos++];
        if (!count) { continue; }
        if (type == 1 || type == 2) {
          // add || presence
          for (let i = 0; i < count; i++) {
            let id = u32[pos++];
            let pointer = "mouse";
            /*
            if (id & (1<<31)) {
              id &= ~(1<<31);
              pointer = "touch";
            }
            */
            const x = f32[pos++];
            const y = f32[pos++];
            updateUser(''+id, {
              cursor: {
                x: x,
                y: y,
                pointer: (pointer == "mouse") ? "mouse" : "touch"
              }
            });
          }
        } else if (type == 3) {
          // remove
          for (let i = 0; i < count; i++) {
            removeUser(''+u32[pos++]);
          }
        }
      }
      return;
    }
    if (event.data.includes("myid")) {
      setMyId(JSON.parse(event.data).myid);
      return;
    } else if (event.data.includes("heartbeat")) {
      setPendingHeartbeat(true);
      return;
    }
    let lines = event.data.split("\n");
    let type = "";
    for (let line of lines) {
      if (line == "your_id" || line == "sync" || line == "add" || line == "presence" || line == "remove") {
        type = line;
        continue;
      }
      if (type == "your_id") {
        setMyId(line);
      } else if (type == "sync" || type == "add" || type == "presence") {
        const split = line.split(",");
        const id = split[0];
        if (id == "") {
          continue;
        }
        let presence: Presence = {cursor: null};
        if (split.length == 4) {
          presence.cursor = {
            x: +split[1],
            y: +split[2],
            pointer: split[3] == "m" ? "mouse" : "touch",
          };
        }
        updateUser(id, presence);
      } else if (type == "remove") {
        removeUser(line);
      }
    }
    if (type == "sync") {
      setSynced(true);
    }
  };

  const handleMessage2 = async (event: MessageEvent) => {
    //const message = JSON.parse(event.data) as PartyMessage;
    const data =
      event.data instanceof Blob
        ? // byte array -> msgpack
          decodeMessage(await event.data.arrayBuffer())
        : // string -> json
          JSON.parse(event.data);

    // hack
    if (!(event.data instanceof Blob)) {
      if (data.myid) {
        setMyId(data.myid);
        return;
      } else if (data.heartbeat) {
        setPendingHeartbeat(true);
        return;
      }
    }

    const result = partyMessageSchema.safeParse(data);
    if (!result.success) return;
    const message = result.data;

    switch (message.type) {
      case "sync":
        // setMyId(socket.id);
        // create Map from message.users (which is id -> User)
        setUsers(new Map<string, User>(Object.entries(message.users)));
        setSynced(true);
        break;
      case "changes":
        updateUsers(message);
        break;
    }
  };

  const socket = usePartySocket({
    id: "0",
    host: props.host,
    // party: "presence",
    room: "rock",
    // Initial presence is sent in the query string
    query: {
      from: (document as any).multiplayerCursorsCC,
    },
    onMessage: (event) => handleMessage(event),

    onClose: (e) =>
      console.warn(
        "Socket closed:",
        e.reason ||
          // @ts-ignore
          e.error ||
          e
      ),
    onError: (e) =>
      console.error(
        "Socket error:",
        // @ts-ignore
        e.reason ||
          // @ts-ignore
          e.error ||
          e
      ),
  });
  (document as any).multiplayerCursorsWs = socket;

  // Send initial presence when syncing
  useEffect(() => {
    if (socket) {
      //setMyId(socket.id);
      if (!synced) {
        const message: ClientMessage = {
          type: "update",
          presence: props.presence,
        };
        socket.send(encodeClientMessage3(message));
      }
    }
  }, [props.presence, setMyId, synced, socket]);

  const queueUpdate = () => {
    if (currentTimeout.id == -1) {
      currentTimeout.id = setTimeout(() => {
        currentTimeout.id = -1;
        const message: ClientMessage = { type: "update", presence: pendingUpdate ? pendingUpdate : {} };
        socket.send(encodeClientMessage3(message));
        clearPendingUpdate();
      }, 25);
    }
  };

  // TODO: https://stackoverflow.com/questions/57788721/react-hook-delayed-useeffect-firing
  useEffect(() => {
    if (!pendingUpdate) return;
    if (!socket) return;
    queueUpdate();
  }, [socket, pendingUpdate, clearPendingUpdate]);

  useEffect(() => {
    if (!pendingHeartbeat) return;
    if (!socket) return;
    socket.send(`{"heartbeat":true}`);
    setPendingHeartbeat(false);
  }, [socket, pendingHeartbeat, setPendingHeartbeat]);

  return (
    <PresenceContext.Provider value={{}}>
      {props.children}
    </PresenceContext.Provider>
  );
}
