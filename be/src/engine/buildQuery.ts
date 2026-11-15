export interface CubeLevel {
  name: string;
  col: string;
  join?: string;
}

export interface CubeFilter {
  join?: string;
  cond: string;
  parse?: (value: string) => unknown;
}

export interface CubeMeasure {
  sql: string;
  additive?: boolean;
}

export interface CubeConfig {
  name: string;
  from: string;
  joins?: Record<string, string>;
  baseWhere?: string[];
  groupingLevels?: readonly CubeLevel[];
  hierarchies: Record<string, readonly CubeLevel[]>;
  measures: Record<string, CubeMeasure>;
  filters?: Record<string, CubeFilter>;
  defaults?: Record<string, string | number | boolean | string[]>;
}

export interface BuildQueryOptions {
  dim: string;
  depth?: number;
  filters?: Record<string, unknown>;
  includeHierarchy?: boolean;
}

export interface BuiltQuery {
  text: string;
  values: unknown[];
  levels: CubeLevel[];
}

const replacePlaceholder = (condition: string, index: number): string => {
  const placeholders = condition.match(/\?/g)?.length ?? 0;
  if (placeholders !== 1) {
    throw new Error('Each cube filter condition must contain exactly one "?" placeholder');
  }
  return condition.replace('?', `$${index}`);
};

export const buildQuery = (
  cube: CubeConfig,
  { dim, depth, filters = {}, includeHierarchy = true }: BuildQueryOptions,
): BuiltQuery => {
  const hierarchy = cube.hierarchies[dim];
  if (!hierarchy) {
    throw new Error(`Unknown dimension "${dim}" for cube "${cube.name}"`);
  }

  const selectedDepth = depth ?? hierarchy.length;
  if (!Number.isInteger(selectedDepth) || selectedDepth < 1 || selectedDepth > hierarchy.length) {
    throw new Error(`Depth for "${dim}" must be between 1 and ${hierarchy.length}`);
  }

  const levels = [
    ...(cube.groupingLevels ?? []),
    ...(includeHierarchy ? hierarchy.slice(0, selectedDepth) : []),
  ];
  const values: unknown[] = [];
  const where = [...(cube.baseWhere ?? [])];
  const joins = new Set<string>();

  levels.forEach((level) => {
    if (level.join) joins.add(level.join);
  });

  const requestedFilters = { ...(cube.defaults ?? {}), ...filters };
  Object.entries(requestedFilters).forEach(([name, value]) => {
    if (value === undefined || value === null || value === '') return;

    const filter = cube.filters?.[name];
    if (!filter) {
      throw new Error(`Unknown filter "${name}" for cube "${cube.name}"`);
    }

    if (filter.join) joins.add(filter.join);
    values.push(filter.parse ? filter.parse(String(value)) : value);
    where.push(replacePlaceholder(filter.cond, values.length));
  });

  const selectedMeasures = Object.entries(cube.measures).map(
    ([name, measure]) => `${measure.sql} AS ${name}`,
  );
  const selectedLevels = levels.flatMap((level, index) => [
    `${level.col} AS l${index + 1}`,
    `GROUPING(${level.col}) AS g${index + 1}`,
  ]);
  const joinSql = [...joins]
    .map((name) => {
      const join = cube.joins?.[name];
      if (!join) throw new Error(`Unknown join "${name}" in cube "${cube.name}"`);
      return join;
    })
    .join('\n');
  const columns = levels.map((level) => level.col).join(', ');
  const orderBy = levels.map((level) => `${level.col} NULLS LAST`).join(', ');

  return {
    text: `SELECT
  ${[...selectedLevels, ...selectedMeasures].join(',\n  ')}
FROM ${cube.from}
${joinSql}
${where.length ? `WHERE ${where.join(' AND ')}` : ''}
GROUP BY ROLLUP(${columns})
ORDER BY ${orderBy}`,
    values,
    levels,
  };
};
