import type * as Party from "partykit/server";
import type {
  Presence,
  User,
  // ClientMessage,
  PartyMessage,
} from "./presence/presence-schema";
import {
  clientMessageSchema,
  decodeMessage,
  encodePartyMessage,
  encodePartyMessage2,
  encodePartyMessage3,
} from "./presence/presence-schema";

export type ConnectionWithUser = Party.Connection<{
  presence?: Presence;
}>;

const BROADCAST_INTERVAL = 1000 / 20; // 20fps

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET",
  "Access-Control-Allow-Headers":
    "Origin, X-Requested-With, Content-Type, Accept",
};

// server.ts
export default class PresenceServer implements Party.Server {
  constructor(public party: Party.Party) {}
  options: Party.ServerOptions = {
    hibernate: true, // TODO: disable hibernate?
  };

  // pending updates are stored in memory and sent every tick
  add: { [id: string]: User } = {};
  presence: { [id: string]: Presence } = {};
  remove: string[] = [];

  lastBroadcast = 0;
  interval: ReturnType<typeof setInterval> | null = null;
  heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  static onBeforeConnect(req: Party.Request, lobby: Party.Lobby) {
    const randomCheck = new URL(req.url).searchParams.get("from");

    if (randomCheck != "cc") {
      return new Response("Not Allowed", { status: 403 });
    }

    return req;
  }

  onStart(): void | Promise<void> {
    this.heartbeatInterval = setInterval(() => {
      //this.party.broadcast(`{"heartbeat": true}`)
    }, 33 * 1000);
  }

  onConnect(
    connection: Party.Connection,
    { request }: Party.ConnectionContext
  ): void | Promise<void> {
    connection.send(`{"myid":"${connection.id}"}`);
    //connection.send(`your_id\n${connection.id}`);

    const presence = {} as Presence;

    // Stash the metadata and the presence on the websocket
    connection.setState((prevState: User) => ({
      presence: { ...prevState?.presence, ...presence },
    }));

    this.join(connection);

    //console.log("onConnect", this.party.id, connection.id, request.cf?.country);
  }

  enqueueAdd(id: string, user: User) {
    this.add[id] = user;
  }

  enqueuePresence(id: string, presence: Presence) {
    this.presence[id] = presence;
  }

  enqueueRemove(id: string) {
    this.remove.push(id);
    delete this.presence[id];
  }

  getUser(connection: ConnectionWithUser): User {
    return {
      presence: connection.state?.presence ?? ({} as Presence),
    };
  }

  makeSyncMessage() {
    // Build users list
    const users = <Record<string, User>>{};
    for (const connection of this.party.getConnections()) {
      const user = this.getUser(connection);
      users[connection.id] = user;
    }

    return {
      type: "sync",
      users,
    } satisfies PartyMessage;
  }

  join(connection: ConnectionWithUser) {
    // Keep the presence on the websocket. onConnect will add metadata
    connection.setState((prevState) => ({
      ...prevState,
      presence: connection.state?.presence ?? ({} as Presence),
    }));
    this.enqueueAdd(connection.id, this.getUser(connection));
    // Reply with the current presence of all connections, including self
    const sync = this.makeSyncMessage();
    //connection.send(JSON.stringify(sync));
    //console.log("sync", JSON.stringify(sync, null, 2));
    const msg = encodePartyMessage3(sync);
    if (msg.byteLength) {
      connection.send(msg);
    }
  }

  leave(connection: ConnectionWithUser) {
    this.enqueueRemove(connection.id);
    this.broadcast().catch((err) => {
      console.error(err);
    });
  }

  onMessage(
    msg: string | ArrayBufferLike,
    connection: ConnectionWithUser
  ): void | Promise<void> {
    let presence: Presence = {};
    if (typeof msg != "string") {
      const view = new DataView(msg);
      let pointer = "mouse";
      if (view.byteLength == 0) {
        presence.cursor = null;
      } else if (/*view.byteLength == 12 ||*/ view.byteLength == 8) {
        /*
        if (view.byteLength == 12) {
          pointer = view.getFloat32(8, true) == 0.0 ? "mouse" : "touch";
        }
        */
        presence.cursor = {
          x: view.getFloat32(0, true),
          y: view.getFloat32(4, true),
          pointer: pointer == "mouse" ? "mouse" : "touch",
        };
      } else {
        connection.close();
        return;
      }
    } else {
      connection.close();
      return;
      /*
      const split = msg.split(",");
      if (split.length > 5) {
        connection.close();
        return;
      }
      if (split.length == 3) {
        presence.cursor = {
          x: +split[0],
          y: +split[1],
          pointer: split[2] == "m" ? "mouse" : "touch",
        };
      }
      */
    }

    connection.setState((prevState) => {
      this.enqueuePresence(connection.id, presence);
      return {
        ...prevState,
        presence
      }
    });

    this.broadcast().catch((err) => {
      console.error(err);
    });
  }

  onMessage2(
    msg: string | ArrayBufferLike,
    connection: ConnectionWithUser
  ): void | Promise<void> {
    //const message = JSON.parse(msg as string) as ClientMessage;
    const result = clientMessageSchema.safeParse(decodeMessage(msg));
    if (!result.success) return;
    const message = result.data;
    /*console.log(
      "onMessage",
      this.party.id,
      connection.id,
      JSON.stringify(message, null, 2)
    );*/
    switch (message.type) {
      case "update": {
        // A presence update, replacing the existing presence
        connection.setState((prevState) => {
          this.enqueuePresence(connection.id, message.presence);
          return {
            ...prevState,
            presence: message.presence,
          };
        });
        break;
      }
    }

    this.broadcast().catch((err) => {
      console.error(err);
    });
  }

  onClose(connection: ConnectionWithUser) {
    this.leave(connection);
  }

  onError(connection: ConnectionWithUser) {
    this.leave(connection);
  }

  async broadcast() {
    // Broadcasts deltas. Looks at lastBroadcast
    // - If it's longer ago than BROADCAST_INTERVAL, broadcasts immediately
    // - If it's less than BROADCAST_INTERVAL ago, schedules an alarm
    //   to broadcast later
    const now = Date.now();
    const ago = now - this.lastBroadcast;
    if (ago >= BROADCAST_INTERVAL) {
      this._broadcast();
    } else {
      if (!this.interval) {
        this.interval = setInterval(() => {
          this._broadcast();
          if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
          }
        }, BROADCAST_INTERVAL - ago);
      }
    }
  }

  _broadcast() {
    this.lastBroadcast = Date.now();

    // Avoid the situation where there's only one connection and we're
    // rebroadcasting its own deltas to it
    const connections = [...this.party.getConnections()];
    const presenceUniqueIds = new Set(Object.keys(this.presence));
    if (
      connections.length === 1 &&
      this.remove.length === 0 &&
      Object.keys(this.add).length === 0 &&
      presenceUniqueIds.size === 1 &&
      presenceUniqueIds.has(connections[0].id)
    ) {
      this.presence = {};
      return;
    }

    const update = {
      type: "changes",
      add: this.add,
      presence: this.presence,
      remove: this.remove,
    } satisfies PartyMessage;
    //this.party.broadcast(JSON.stringify(update));
    const msg = encodePartyMessage3(update);
    if (msg.byteLength) {
      this.party.broadcast(msg);
    }
    this.add = {};
    this.presence = {};
    this.remove = [];
  }

  async onRequest(req: Party.Request) {
    if (req.method === "GET") {
      // For SSR, return the current presence of all connections
      const users = [...this.party.getConnections()].reduce(
        (acc, user) => ({ ...acc, [user.id]: this.getUser(user) }),
        {}
      );
      return Response.json({ users }, { status: 200, headers: CORS });
    }

    // respond to cors preflight requests
    if (req.method === "OPTIONS") {
      return Response.json({ ok: true }, { status: 200, headers: CORS });
    }

    return new Response("Method Not Allowed", { status: 405 });
  }
}

PresenceServer satisfies Party.Worker;
