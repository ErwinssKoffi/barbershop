import { beforeEach,expect,it,vi } from 'vitest'
import { fireEvent,render,screen } from '@testing-library/react'
import { AuthContext,type AuthContextValue } from '../contexts/authContext'
import { VisibilityPublicationPanel } from '../features/visibility/VisibilityPublicationPanel'
import { visibilityPublicationRequest,unpublishVisibilityRequest } from '../lib/visibilityClient'
import { parsePublicationStatus } from '../domain/visibilityPublication'
import { marketplaceMigrationOptions } from '../../server/migrationOptions'
vi.mock('../lib/visibilityClient',()=>({visibilityPublicationRequest:vi.fn(),unpublishVisibilityRequest:vi.fn()}))
const data=()=>({version:1,visibility:'visible' as const,publicationRequested:true,publishedRevision:1,canPublish:false as const,blockers:[{code:'PUBLICATION_RIGHTS_NOT_CONNECTED',message:'Droits non raccordés.'}]})
const changed=vi.fn()
function panel(){return <AuthContext.Provider value={{currentUser:{id:'manager',tenantId:'tenant',isActive:true,role:'manager'}} as AuthContextValue}><VisibilityPublicationPanel onChanged={changed}/></AuthContext.Provider>}
beforeEach(()=>vi.resetAllMocks())
it('confirmation obligatoire avant dépublication, publier toujours désactivé',async()=>{
 vi.mocked(visibilityPublicationRequest).mockResolvedValueOnce(data()).mockResolvedValueOnce({...data(),visibility:'not_visible',publicationRequested:false,version:2})
 vi.mocked(unpublishVisibilityRequest).mockResolvedValue({version:2,changed:true})
 render(panel());expect(screen.getByText('Publier des photos — stockage sécurisé non raccordé')).toBeDisabled()
 fireEvent.click(screen.getByText('Vérifier l’état de publication'))
 await screen.findByText('Droits non raccordés.')
 expect(screen.getByText('Dépublier la fiche')).toBeDisabled()
 fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByText('Dépublier la fiche'))
 await screen.findByText('Dépublication enregistrée. Rechargez les éditeurs avant toute modification.')
 expect(unpublishVisibilityRequest).toHaveBeenCalledWith(expect.anything(),1);expect(changed).toHaveBeenCalledTimes(1)
 expect(screen.getByText('Dépublier la fiche')).toBeDisabled()
})
it('échec ou conflit exige relecture et aucune réussite fictive',async()=>{
 vi.mocked(visibilityPublicationRequest).mockResolvedValue(data());vi.mocked(unpublishVisibilityRequest).mockRejectedValue(new Error('Rechargez.'))
 render(panel());fireEvent.click(screen.getByText('Vérifier l’état de publication'));await screen.findByText('Droits non raccordés.')
 fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByText('Dépublier la fiche'));await screen.findByText('Rechargez.')
 expect(screen.getByText('Dépublier la fiche')).toBeDisabled();expect(changed).not.toHaveBeenCalled()
})
it('DTO ne peut pas activer publier et ne divulgue aucun champ injecté',()=>{
 expect(parsePublicationStatus({...data(),privateKey:'private'})).toEqual(data())
 for(const change of [{canPublish:true},{version:0},{blockers:[]},{publicationRequested:'true'},{visibility:'published'}])expect(()=>parsePublicationStatus({...data(),...change})).toThrow()
})
it('opt-in 018 séparé et approbation sauvegarde requise',()=>{
 expect(()=>marketplaceMigrationOptions(['--include-visibility-unpublish'],undefined)).toThrow(/backup/)
 expect(marketplaceMigrationOptions(['--include-visibility-unpublish'],'true')).toEqual({includeMarketplace:true,includeVisibilityPublication:true})
})
