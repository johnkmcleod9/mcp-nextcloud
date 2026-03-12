// ─── Domain Models ───

export interface Board {
  id: number;
  title: string;
  owner: {
    primaryKey: string;
    uid: string;
    displayname: string;
  };
  color: string;
  archived: boolean;
  labels: Label[];
  acl: Acl[];
  permissions: {
    PERMISSION_READ: boolean;
    PERMISSION_EDIT: boolean;
    PERMISSION_MANAGE: boolean;
    PERMISSION_SHARE: boolean;
  };
  users: BoardUser[];
  shared: number;
  deletedAt: number;
  lastModified: number;
}

export interface Stack {
  id: number;
  title: string;
  boardId: number;
  deletedAt: number;
  lastModified: number;
  order: number;
  cards: Card[];
}

export interface Card {
  id: number;
  title: string;
  description: string;
  stackId: number;
  type: string;
  lastModified: number;
  lastEditor: string | null;
  createdAt: number;
  labels: Label[];
  assignedUsers: CardAssignment[];
  attachments: Attachment[] | null;
  attachmentCount: number;
  owner: {
    primaryKey: string;
    uid: string;
    displayname: string;
  };
  order: number;
  archived: boolean;
  done: string | null;
  duedate: string | null;
  deletedAt: number;
  commentsUnread: number;
  commentsCount: number;
  ETag: string;
  overdue: number;
}

export interface Label {
  id: number;
  title: string;
  color: string;
  boardId: number;
  cardId: number | null;
  lastModified: number;
  ETag: string;
}

export interface Acl {
  id: number;
  participant: {
    primaryKey: string;
    uid: string;
    displayname: string;
  };
  type: number;
  boardId: number;
  permissionEdit: boolean;
  permissionShare: boolean;
  permissionManage: boolean;
  owner: boolean;
}

export interface BoardUser {
  primaryKey: string;
  uid: string;
  displayname: string;
}

export interface CardAssignment {
  id: number;
  participant: {
    primaryKey: string;
    uid: string;
    displayname: string;
  };
  type: number;
  cardId: number;
}

export interface Attachment {
  id: number;
  cardId: number;
  type: string;
  data: string;
  lastModified: number;
  createdAt: number;
  createdBy: string;
  deletedAt: number;
  extendedData: Record<string, unknown>;
}

export interface DeckComment {
  id: number;
  objectId: number;
  message: string;
  actorId: string;
  actorDisplayName: string;
  creationDateTime: string;
  replyTo: number | null;
}

// ─── Response Models ───

export interface CreateBoardResponse {
  id: number;
  title: string;
  color: string;
}

export interface CreateStackResponse {
  id: number;
  title: string;
  boardId: number;
  order: number;
}

export interface CardResponse {
  id: number;
  title: string;
  description: string;
  stackId: number;
  duedate: string | null;
  done: string | null;
  order: number;
  assignedUsers: string[];
  labels: string[];
}

export interface SearchResult {
  card: Card;
  boardId: number;
  boardTitle: string;
  stackId: number;
  stackTitle: string;
}

export interface CommentResponse {
  id: number;
  message: string;
  actorDisplayName: string;
  creationDateTime: string;
}

export interface AttachmentResponse {
  id: number;
  cardId: number;
  type: string;
  data: string;
  createdBy: string;
  lastModified: number;
}
