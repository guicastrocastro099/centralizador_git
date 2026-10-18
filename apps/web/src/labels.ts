export const PROJECT_TYPES: [string, string][] = [
  ["produto", "Produto"],
  ["experimento", "Experimento"],
  ["biblioteca", "Biblioteca"],
  ["site", "Site"],
  ["ferramenta", "Ferramenta"],
  ["pesquisa", "Pesquisa"],
  ["automacao", "Automação"],
  ["estudo", "Estudo"],
];

export const CODE_KINDS: [string, string][] = [
  ["aplicacao", "Aplicação"],
  ["biblioteca", "Biblioteca"],
  ["script", "Script"],
  ["infraestrutura", "Infraestrutura"],
  ["dados", "Dados"],
  ["documentacao", "Documentação"],
  ["misto", "Misto"],
];

export function label(list: [string, string][], value: string | null) {
  return list.find(([key]) => key === value)?.[1] ?? "Sem tipo";
}
