import { DeckClient } from '../client/deck.js';
import { getClient } from '../utils/client-manager.js';

// ─── Board Handlers ───

export async function handleListBoards() {
  const client = getClient(DeckClient);
  const boards = await client.listBoards();
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          boards.map((b) => ({
            id: b.id,
            title: b.title,
            color: b.color,
            archived: b.archived,
          })),
          null,
          2
        ),
      },
    ],
  };
}

export async function handleGetBoard(board_id: number) {
  const client = getClient(DeckClient);
  const board = await client.getBoard(board_id);
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(board, null, 2) }],
  };
}

export async function handleCreateBoard(
  title: string,
  color: string,
  shareWithUsers?: string[],
  shareWithGroups?: string[]
) {
  const client = getClient(DeckClient);
  const board = await client.createBoard(title, color);

  const sharedWith: string[] = ['AI Agents group'];

  // Share with additional users (type 0)
  if (shareWithUsers) {
    for (const user of shareWithUsers) {
      try {
        await client.shareBoard(board.id, user, 0);
        sharedWith.push(user);
      } catch { /* non-fatal */ }
    }
  }

  // Share with additional groups (type 1)
  if (shareWithGroups) {
    for (const group of shareWithGroups) {
      try {
        await client.shareBoard(board.id, group, 1);
        sharedWith.push(`${group} group`);
      } catch { /* non-fatal */ }
    }
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          { id: board.id, title: board.title, color: board.color, shared_with: sharedWith },
          null,
          2
        ),
      },
    ],
  };
}

export async function handleShareBoard(
  board_id: number,
  participant: string,
  type: number,
  permission_edit: boolean,
  permission_share: boolean,
  permission_manage: boolean
) {
  const client = getClient(DeckClient);
  const acl = await client.shareBoard(board_id, participant, type, permission_edit, permission_share, permission_manage);
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            aclId: acl.id,
            participant: acl.participant?.displayname ?? participant,
            type: type === 0 ? 'user' : 'group',
            permissionEdit: acl.permissionEdit,
            permissionShare: acl.permissionShare,
            permissionManage: acl.permissionManage,
          },
          null,
          2
        ),
      },
    ],
  };
}

// ─── Stack Handlers ───

export async function handleListStacks(board_id: number) {
  const client = getClient(DeckClient);
  const stacks = await client.listStacks(board_id);
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          stacks.map((s) => ({
            id: s.id,
            title: s.title,
            order: s.order,
            cardCount: s.cards?.length ?? 0,
          })),
          null,
          2
        ),
      },
    ],
  };
}

export async function handleCreateStack(board_id: number, title: string, order: number) {
  const client = getClient(DeckClient);
  const stack = await client.createStack(board_id, title, order);
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          { id: stack.id, title: stack.title, boardId: stack.boardId, order: stack.order },
          null,
          2
        ),
      },
    ],
  };
}

// ─── Card Handlers ───

export async function handleGetCard(board_id: number, stack_id: number, card_id: number) {
  const client = getClient(DeckClient);
  const card = await client.getCard(board_id, stack_id, card_id);
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(card, null, 2) }],
  };
}

export async function handleCreateCard(
  board_id: number,
  stack_id: number,
  title: string,
  description?: string,
  duedate?: string
) {
  const client = getClient(DeckClient);
  const card = await client.createCard(board_id, stack_id, title, description, duedate);
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            id: card.id,
            title: card.title,
            stackId: card.stackId,
            duedate: card.duedate,
          },
          null,
          2
        ),
      },
    ],
  };
}

export async function handleUpdateCard(
  board_id: number,
  stack_id: number,
  card_id: number,
  fields: {
    title?: string;
    description?: string;
    duedate?: string | null;
    done?: string | null;
  }
) {
  const client = getClient(DeckClient);
  const card = await client.updateCard(board_id, stack_id, card_id, fields);
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            id: card.id,
            title: card.title,
            description: card.description?.substring(0, 200),
            duedate: card.duedate,
            done: card.done,
          },
          null,
          2
        ),
      },
    ],
  };
}

export async function handleMoveCard(
  board_id: number,
  stack_id: number,
  card_id: number,
  new_stack_id: number,
  order: number
) {
  const client = getClient(DeckClient);
  const cards = await client.moveCard(board_id, stack_id, card_id, new_stack_id, order);
  const moved = cards.find((c) => c.id === card_id);
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            id: moved?.id ?? card_id,
            title: moved?.title,
            stackId: moved?.stackId ?? new_stack_id,
            order: moved?.order ?? order,
          },
          null,
          2
        ),
      },
    ],
  };
}

export async function handleAssignUser(
  board_id: number,
  stack_id: number,
  card_id: number,
  user_id: string
) {
  const client = getClient(DeckClient);
  try {
    await client.assignUser(board_id, stack_id, card_id, user_id);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ status: 'assigned', userId: user_id, cardId: card_id }),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: error.message }) }],
    };
  }
}

export async function handleUnassignUser(
  board_id: number,
  stack_id: number,
  card_id: number,
  user_id: string
) {
  const client = getClient(DeckClient);
  try {
    await client.unassignUser(board_id, stack_id, card_id, user_id);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ status: 'unassigned', userId: user_id, cardId: card_id }),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ error: error.message }) }],
    };
  }
}

// ─── Comment Handler ───

export async function handleAddComment(card_id: number, message: string) {
  const client = getClient(DeckClient);
  const comment = await client.addComment(card_id, message);
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            id: comment.id,
            message: comment.message,
            actor: comment.actorDisplayName,
            created: comment.creationDateTime,
          },
          null,
          2
        ),
      },
    ],
  };
}

// ─── Search Handler ───

export async function handleSearchCards(query: string) {
  const client = getClient(DeckClient);
  const results = await client.searchCards(query);
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          {
            query,
            total_found: results.length,
            results: results.map((r) => ({
              cardId: r.card.id,
              title: r.card.title,
              description: r.card.description?.substring(0, 100),
              boardId: r.boardId,
              boardTitle: r.boardTitle,
              stackId: r.stackId,
              stackTitle: r.stackTitle,
              duedate: r.card.duedate,
              done: r.card.done,
            })),
          },
          null,
          2
        ),
      },
    ],
  };
}

// ─── Attachment Handlers ───

export async function handleListAttachments(
  board_id: number,
  stack_id: number,
  card_id: number
) {
  const client = getClient(DeckClient);
  const attachments = await client.listAttachments(board_id, stack_id, card_id);
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          attachments.map((a) => ({
            id: a.id,
            data: a.data,
            type: a.type,
            createdBy: a.createdBy,
            lastModified: a.lastModified,
          })),
          null,
          2
        ),
      },
    ],
  };
}

export async function handleAddAttachment(
  board_id: number,
  stack_id: number,
  card_id: number,
  file_content_base64: string,
  file_name: string
) {
  const client = getClient(DeckClient);
  const fileBuffer = Buffer.from(file_content_base64, 'base64');
  const attachment = await client.addAttachment(board_id, stack_id, card_id, fileBuffer, file_name);
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(
          { id: attachment.id, data: attachment.data, type: attachment.type },
          null,
          2
        ),
      },
    ],
  };
}

export async function handleGetAttachment(
  board_id: number,
  stack_id: number,
  card_id: number,
  attachment_id: number
) {
  const client = getClient(DeckClient);
  const buffer = await client.getAttachment(board_id, stack_id, card_id, attachment_id);
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          attachment_id,
          size_bytes: buffer.length,
          content_base64: buffer.toString('base64'),
        }),
      },
    ],
  };
}
