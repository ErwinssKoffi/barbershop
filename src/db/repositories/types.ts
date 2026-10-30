export interface IRepository<T extends { id: string }> {
  getAll(): Promise<T[]>
  getById(id: string): Promise<T | undefined>
  create(item: T): Promise<T>
  update(id: string, changes: Partial<T>): Promise<T>
  archive?(id: string): Promise<void>
  delete(id: string): Promise<void>
}
