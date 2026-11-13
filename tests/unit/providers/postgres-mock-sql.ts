import type { Sql } from 'postgres'

export type MockQueryHandler = (
  strings: TemplateStringsArray,
  ..._values: readonly unknown[]
) => Promise<readonly unknown[]> | readonly unknown[]

type MockSqlTarget = MockQueryHandler & {
  begin?: <T>(cb: (sql: Sql) => Promise<T>) => Promise<T>
}

export function createMockSql(
  handler: MockQueryHandler,
  onTransaction?: (active: boolean) => void,
): Sql {
  let proxyInstance: Sql
  const targetHandler: MockSqlTarget = Object.assign(handler, {
    begin: async <T>(cb: (sql: Sql) => Promise<T>): Promise<T> => {
      onTransaction?.(true)
      try {
        return await cb(proxyInstance)
      } finally {
        onTransaction?.(false)
      }
    },
  })
  const proxy = new Proxy(targetHandler, {
    apply(_target, _thisArg, [strings, ...values]: [TemplateStringsArray, ...unknown[]]) {
      return handler(strings, ...values)
    },
    get(target, prop) {
      if (prop === 'begin') {
        return target.begin
      }
      return undefined
    },
  })
  // SAFETY: Mock SQL proxy provides the template tag execution contract required by PostgresDomainStore
  proxyInstance = proxy as Sql
  return proxyInstance
}
