import { BaseNextcloudClient } from './base.js';
import {
  Board,
  Stack,
  Card,
} from '../models/deck.js';

const DECK_API = '/index.php/apps/deck/api/v1.0';

export class DeckClient extends BaseNextcloudClient {

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
}
