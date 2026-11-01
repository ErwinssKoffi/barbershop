/** Catalogue service categories are not accounting revenue categories. */
export function serviceRevenueCategory(categoryCode: string): string {
 if (['tresses_nattes','meches_perruques'].includes(categoryCode)) return 'braiding_weaving'
 if (['coloration','soins_brushing'].includes(categoryCode)) return 'care_coloring'
 return 'hair_service'
}
