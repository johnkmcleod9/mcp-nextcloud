import { BaseNextcloudClient } from './base.js';
import {
  Board,
  Stack,
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
}
