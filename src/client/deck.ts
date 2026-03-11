import { BaseNextcloudClient } from './base.js';
import {
  Board,
  Stack,
  Card,
  DeckComment,
  SearchResult,
  Attachment,
} from '../models/deck.js';

const DECK_API = '/index.php/apps/deck/api/v1.0';

export class DeckClient extends BaseNextcloudClient {

  private readonly OCS_DECK_API = '/ocs/v2.php/apps/deck/api/v1.0';

  // ─── Boards ───

  async listBoards(): Promise<Board[]> {
    return this.makeRequest<Board[]>({ method: 'GET', url: `${DECK_API}/boards` });
  }

  async getBoard(boardId: number): Promise<Board> {
    return this.makeRequest<Board>({ method: 'GET', url: `${DECK_API}/boards/${boardId}` });
  }

  async createBoard(title: string, color: string): Promise<Board> {
    return this.makeRequest<Board>({ method: 'POST', url: `${DECK_API}/boards`, data: { title, color } });
  }

  // ─── Stacks ───

  async listStacks(boardId: number): Promise<Stack[]> {
    return this.makeRequest<Stack[]>({ method: 'GET', url: `${DECK_API}/boards/${boardId}/stacks` });
  }

  async createStack(boardId: number, title: string, order: number): Promise<Stack> {
    return this.makeRequest<Stack>({
      method: 'POST',
      url: `${DECK_API}/boards/${boardId}/stacks`,
      data: { title, order },
    });
  }

  // ─── Cards ───

  async getCard(boardId: number, stackId: number, cardId: number): Promise<Card> {
    return this.makeRequest<Card>({
      method: 'GET',
      url: `${DECK_API}/boards/${boardId}/stacks/${stackId}/cards/${cardId}`,
    });
  }

  async createCard(
    boardId: number,
    stackId: number,
    title: string,
    description?: string,
    duedate?: string
  ): Promise<Card> {
    return this.makeRequest<Card>({
      method: 'POST',
      url: `${DECK_API}/boards/${boardId}/stacks/${stackId}/cards`,
      data: { title, type: 'plain', order: 0, description, duedate },
    });
  }

  async updateCard(
    boardId: number,
    stackId: number,
    cardId: number,
    fields: {
      title?: string;
      description?: string;
      duedate?: string | null;
      done?: string | null;
      order?: number;
      archived?: boolean;
    }
  ): Promise<Card> {
    return this.makeRequest<Card>({
      method: 'PUT',
      url: `${DECK_API}/boards/${boardId}/stacks/${stackId}/cards/${cardId}`,
      data: fields,
    });
  }

  async moveCard(
    boardId: number,
    stackId: number,
    cardId: number,
    newStackId: number,
    order: number
  ): Promise<Card> {
    return this.makeRequest<Card>({
      method: 'PUT',
      url: `${DECK_API}/boards/${boardId}/stacks/${stackId}/cards/${cardId}/reorder`,
      data: { stackId: newStackId, order },
    });
  }

  async assignUser(
    boardId: number,
    stackId: number,
    cardId: number,
    userId: string
  ): Promise<void> {
    try {
      await this.makeRequest<void>({
        method: 'PUT',
        url: `${DECK_API}/boards/${boardId}/stacks/${stackId}/cards/${cardId}/assignUser`,
        data: { userId },
      });
    } catch (error: any) {
      if (error?.message?.includes('400')) {
        throw new Error(
          `Cannot assign user "${userId}": they may already be assigned or are not a member of this board.`
        );
      }
      throw error;
    }
  }

  async unassignUser(
    boardId: number,
    stackId: number,
    cardId: number,
    userId: string
  ): Promise<void> {
    try {
      await this.makeRequest<void>({
        method: 'PUT',
        url: `${DECK_API}/boards/${boardId}/stacks/${stackId}/cards/${cardId}/unassignUser`,
        data: { userId },
      });
    } catch (error: any) {
      if (error?.message?.includes('400')) {
        throw new Error(
          `Cannot unassign user "${userId}": they may not be assigned to this card.`
        );
      }
      throw error;
    }
  }

  // ─── Comments ───
  // Note: OCS endpoints return {ocs: {meta: {...}, data: ...}} envelope.
  // We unwrap to return just the data.

  async addComment(cardId: number, message: string): Promise<DeckComment> {
    const response = await this.makeRequest<{ ocs: { data: DeckComment } }>({
      method: 'POST',
      url: `${this.OCS_DECK_API}/cards/${cardId}/comments`,
      data: { message },
    });
    return response.ocs.data;
  }

  // ─── Search ───

  async searchCards(query: string): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    // Step 1: Get all non-archived boards
    const boards = await this.listBoards();
    const activeBoards = boards.filter((b) => !b.archived && !b.deletedAt);

    // Step 2: For each board, get stacks (which include cards)
    for (const board of activeBoards) {
      let stacks: Stack[];
      try {
        stacks = await this.listStacks(board.id);
      } catch {
        // Skip boards we can't access (e.g., 403)
        continue;
      }

      // Step 3: Filter cards by title/description match
      for (const stack of stacks) {
        if (!stack.cards) continue;
        for (const card of stack.cards) {
          if (card.archived || card.deletedAt) continue;
          const titleMatch = card.title.toLowerCase().includes(lowerQuery);
          const descMatch = card.description?.toLowerCase().includes(lowerQuery);
          if (titleMatch || descMatch) {
            results.push({
              card,
              boardId: board.id,
              boardTitle: board.title,
              stackId: stack.id,
              stackTitle: stack.title,
            });
          }
        }
      }
    }

    return results;
  }

  // ─── Attachments ───

  async listAttachments(
    boardId: number,
    stackId: number,
    cardId: number
  ): Promise<Attachment[]> {
    return this.makeRequest<Attachment[]>({
      method: 'GET',
      url: `${DECK_API}/boards/${boardId}/stacks/${stackId}/cards/${cardId}/attachments`,
    });
  }

  async addAttachment(
    boardId: number,
    stackId: number,
    cardId: number,
    fileData: Buffer,
    fileName: string
  ): Promise<Attachment> {
    // Attachments require multipart/form-data — use axios directly
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('file', fileData, { filename: fileName });
    form.append('type', 'file');

    const response = await this.client.post(
      `${DECK_API}/boards/${boardId}/stacks/${stackId}/cards/${cardId}/attachments`,
      form,
      { headers: form.getHeaders() }
    );
    return response.data;
  }

  async getAttachment(
    boardId: number,
    stackId: number,
    cardId: number,
    attachmentId: number
  ): Promise<Buffer> {
    const response = await this.client.get(
      `${DECK_API}/boards/${boardId}/stacks/${stackId}/cards/${cardId}/attachments/${attachmentId}`,
      { responseType: 'arraybuffer' }
    );
    return Buffer.from(response.data);
  }
}
