import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { prefixToolName } from '../utils/tool-naming.js';
import {
  handleListBoards,
  handleGetBoard,
  handleDeleteBoard,
  handleArchiveBoard,
  handleCreateBoard,
  handleListStacks,
  handleCreateStack,
  handleGetCard,
  handleCreateCard,
  handleUpdateCard,
  handleMoveCard,
  handleAssignUser,
  handleUnassignUser,
  handleAddComment,
  handleSearchCards,
  handleListAttachments,
  handleAddAttachment,
  handleGetAttachment,
  handleShareBoard,
} from '../server/deck.js';

export function registerDeckTools(server: McpServer): void {
  // ─── Boards ───

  server.tool(
    prefixToolName('deck_list_boards'),
    'List all Deck boards the user has access to',
    {},
    async () => handleListBoards()
  );

  server.tool(
    prefixToolName('deck_get_board'),
    'Get details of a specific Deck board including stacks and cards',
    {
      board_id: z.number().describe('The ID of the board'),
    },
    async ({ board_id }) => handleGetBoard(board_id)
  );

  server.tool(
    prefixToolName('deck_delete_board'),
    'Delete a Deck board (soft-delete). Only the board owner can delete it.',
    {
      board_id: z.number().describe('The ID of the board to delete'),
    },
    async ({ board_id }) => handleDeleteBoard(board_id)
  );

  server.tool(
    prefixToolName('deck_archive_board'),
    'Archive or unarchive a Deck board. Archived boards are hidden from the main board list but preserved.',
    {
      board_id: z.number().describe('The ID of the board'),
      archived: z.boolean().describe('true to archive, false to unarchive'),
    },
    async ({ board_id, archived }) => handleArchiveBoard(board_id, archived)
  );

  server.tool(
    prefixToolName('deck_create_board'),
    'Create a new Deck board. Automatically shared with the AI Agents group. Optionally share with additional users or groups so they can see the board and be assigned to cards.',
    {
      title: z.string().describe('Title of the board'),
      color: z.string().describe('Hex color code without # (e.g., "0087C5")'),
      share_with_users: z.array(z.string()).optional().describe('Additional Nextcloud usernames to share the board with'),
      share_with_groups: z.array(z.string()).optional().describe('Additional Nextcloud group names to share the board with (e.g., "Employee", "Contractor")'),
    },
    async ({ title, color, share_with_users, share_with_groups }) =>
      handleCreateBoard(title, color, share_with_users, share_with_groups)
  );

  server.tool(
    prefixToolName('deck_share_board'),
    'Share a Deck board with a user or group. Type 0 = user, type 1 = group.',
    {
      board_id: z.number().describe('The ID of the board'),
      participant: z.string().describe('Username or group name to share with'),
      type: z.number().describe('0 for user, 1 for group'),
      permission_edit: z.boolean().optional().default(true).describe('Allow editing'),
      permission_share: z.boolean().optional().default(true).describe('Allow re-sharing'),
      permission_manage: z.boolean().optional().default(false).describe('Allow managing board settings'),
    },
    async ({ board_id, participant, type, permission_edit, permission_share, permission_manage }) =>
      handleShareBoard(board_id, participant, type, permission_edit, permission_share, permission_manage)
  );

  // ─── Stacks ───

  server.tool(
    prefixToolName('deck_list_stacks'),
    'List all stacks (columns) on a Deck board. Response includes cards in each stack.',
    {
      board_id: z.number().describe('The ID of the board'),
    },
    async ({ board_id }) => handleListStacks(board_id)
  );

  server.tool(
    prefixToolName('deck_create_stack'),
    'Create a new stack (column) on a Deck board',
    {
      board_id: z.number().describe('The ID of the board'),
      title: z.string().describe('Title of the stack'),
      order: z.number().describe('Position order of the stack (0-based)'),
    },
    async ({ board_id, title, order }) => handleCreateStack(board_id, title, order)
  );

  // ─── Cards ───

  server.tool(
    prefixToolName('deck_get_card'),
    'Get full details of a single card including description, assignments, and labels',
    {
      board_id: z.number().describe('The ID of the board'),
      stack_id: z.number().describe('The ID of the stack'),
      card_id: z.number().describe('The ID of the card'),
    },
    async ({ board_id, stack_id, card_id }) => handleGetCard(board_id, stack_id, card_id)
  );

  server.tool(
    prefixToolName('deck_create_card'),
    'Create a new card (task) on a Deck board. Description supports Markdown.',
    {
      board_id: z.number().describe('The ID of the board'),
      stack_id: z.number().describe('The ID of the stack to create the card in'),
      title: z.string().describe('Title of the card'),
      description: z
        .string()
        .optional()
        .describe('Card description (supports Markdown)'),
      duedate: z
        .string()
        .optional()
        .describe('Due date in ISO 8601 format (e.g., "2026-03-15T00:00:00+00:00")'),
    },
    async ({ board_id, stack_id, title, description, duedate }) =>
      handleCreateCard(board_id, stack_id, title, description, duedate)
  );

  server.tool(
    prefixToolName('deck_update_card'),
    'Update an existing card. Only provided fields are changed. Description supports Markdown.',
    {
      board_id: z.number().describe('The ID of the board'),
      stack_id: z.number().describe('The ID of the stack'),
      card_id: z.number().describe('The ID of the card to update'),
      title: z.string().optional().describe('New title'),
      description: z.string().optional().describe('New description (Markdown)'),
      duedate: z.string().nullable().optional().describe('New due date (ISO 8601) or null to clear'),
      done: z.string().nullable().optional().describe('Mark done with ISO 8601 datetime, or null to unmark'),
    },
    async ({ board_id, stack_id, card_id, title, description, duedate, done }) => {
      const fields: Record<string, unknown> = {};
      if (title !== undefined) fields.title = title;
      if (description !== undefined) fields.description = description;
      if (duedate !== undefined) fields.duedate = duedate;
      if (done !== undefined) fields.done = done;
      return handleUpdateCard(board_id, stack_id, card_id, fields as any);
    }
  );

  server.tool(
    prefixToolName('deck_move_card'),
    'Move a card to a different stack (column) on the same board',
    {
      board_id: z.number().describe('The ID of the board'),
      stack_id: z.number().describe('The current stack ID of the card'),
      card_id: z.number().describe('The ID of the card to move'),
      new_stack_id: z.number().describe('The destination stack ID'),
      order: z.number().describe('Position in the destination stack (0-based)'),
    },
    async ({ board_id, stack_id, card_id, new_stack_id, order }) =>
      handleMoveCard(board_id, stack_id, card_id, new_stack_id, order)
  );

  server.tool(
    prefixToolName('deck_assign_user'),
    'Assign a user to a card. The user must be a member of the board.',
    {
      board_id: z.number().describe('The ID of the board'),
      stack_id: z.number().describe('The ID of the stack'),
      card_id: z.number().describe('The ID of the card'),
      user_id: z.string().describe('Nextcloud username to assign'),
    },
    async ({ board_id, stack_id, card_id, user_id }) =>
      handleAssignUser(board_id, stack_id, card_id, user_id)
  );

  server.tool(
    prefixToolName('deck_unassign_user'),
    'Remove a user assignment from a card',
    {
      board_id: z.number().describe('The ID of the board'),
      stack_id: z.number().describe('The ID of the stack'),
      card_id: z.number().describe('The ID of the card'),
      user_id: z.string().describe('Nextcloud username to unassign'),
    },
    async ({ board_id, stack_id, card_id, user_id }) =>
      handleUnassignUser(board_id, stack_id, card_id, user_id)
  );

  // ─── Comments ───

  server.tool(
    prefixToolName('deck_add_comment'),
    'Add a comment to a Deck card',
    {
      card_id: z.number().describe('The ID of the card'),
      message: z.string().describe('Comment text'),
    },
    async ({ card_id, message }) => handleAddComment(card_id, message)
  );

  // ─── Search ───

  server.tool(
    prefixToolName('deck_search_cards'),
    'Search for cards across all Deck boards by keyword. Matches against card title and description.',
    {
      query: z.string().describe('Search query string'),
    },
    async ({ query }) => handleSearchCards(query)
  );

  // ─── Attachments ───

  server.tool(
    prefixToolName('deck_list_attachments'),
    'List all attachments on a Deck card',
    {
      board_id: z.number().describe('The ID of the board'),
      stack_id: z.number().describe('The ID of the stack'),
      card_id: z.number().describe('The ID of the card'),
    },
    async ({ board_id, stack_id, card_id }) =>
      handleListAttachments(board_id, stack_id, card_id)
  );

  server.tool(
    prefixToolName('deck_add_attachment'),
    'Upload and attach a file to a Deck card',
    {
      board_id: z.number().describe('The ID of the board'),
      stack_id: z.number().describe('The ID of the stack'),
      card_id: z.number().describe('The ID of the card'),
      file_content_base64: z.string().describe('File content as base64 encoded string'),
      file_name: z.string().describe('Name for the attached file'),
    },
    async ({ board_id, stack_id, card_id, file_content_base64, file_name }) =>
      handleAddAttachment(board_id, stack_id, card_id, file_content_base64, file_name)
  );

  server.tool(
    prefixToolName('deck_get_attachment'),
    'Download an attachment from a Deck card. Returns base64 encoded content.',
    {
      board_id: z.number().describe('The ID of the board'),
      stack_id: z.number().describe('The ID of the stack'),
      card_id: z.number().describe('The ID of the card'),
      attachment_id: z.number().describe('The ID of the attachment'),
    },
    async ({ board_id, stack_id, card_id, attachment_id }) =>
      handleGetAttachment(board_id, stack_id, card_id, attachment_id)
  );
}
