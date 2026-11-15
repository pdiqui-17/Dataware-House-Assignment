import { hierarchies } from "../config/hierarchies.config.js"
import { AnalysisDimension } from "../types/sale.js";

export const filterService = async() : Promise<AnalysisDimension[]>  => {
  const filterList = Object.keys(hierarchies) as AnalysisDimension[];

  return filterList;
}