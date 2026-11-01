import { emptyProfileDetails } from '../domain/profileDetails'
import { beforeEach,expect,it,vi } from 'vitest'
import { fireEvent,render,screen,waitFor } from '@testing-library/react'
import { VisibilityPage } from '../features/visibility/VisibilityPage'
import { AuthContext,type AuthContextValue } from '../contexts/authContext'
import { visibilityRequest } from '../lib/visibilityClient'
vi.mock('../lib/visibilityClient',()=>({visibilityRequest:vi.fn()}))
const user={id:'manager',tenantId:'tenant-a',role:'manager',isActive:true,fullName:'Gérant'}
function panel(role='manager'){return <AuthContext.Provider value={{currentUser:{...user,role}} as AuthContextValue}><VisibilityPage/></AuthContext.Provider>}
beforeEach(()=>vi.resetAllMocks())
it('charge avant édition, aperçu échappé et sauvegarde versionnée sans publication',async()=>{
  vi.mocked(visibilityRequest).mockResolvedValueOnce(null).mockResolvedValueOnce({id:'profile',tenantId:'tenant-a',displayName:'<script>contenu</script>',description:'',city:'',commune:'',publicPhone:null,version:1})
  render(panel())
  expect(screen.getByLabelText('Nom public')).toBeDisabled()
  fireEvent.click(screen.getByText('Charger / recharger le brouillon'))
  await waitFor(()=>expect(screen.getByLabelText('Nom public')).toBeEnabled())
  fireEvent.change(screen.getByLabelText('Nom public'),{target:{value:'<script>contenu</script>'}})
  expect(document.querySelector('script')).toBeNull()
  fireEvent.click(screen.getByText('Enregistrer le brouillon'))
  await screen.findByText('Brouillon enregistré sur le serveur. Aucune publication effectuée.')
  expect(visibilityRequest).toHaveBeenLastCalledWith(expect.objectContaining({id:'manager'}),'save',expect.objectContaining({expectedVersion:0,displayName:'<script>contenu</script>'}))
})
it('échec réseau/conflit interdit nouvelle soumission avant relecture',async()=>{
  vi.mocked(visibilityRequest).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('Rechargez le brouillon.'))
  render(panel());fireEvent.click(screen.getByText('Charger / recharger le brouillon'))
  await waitFor(()=>expect(screen.getByLabelText('Nom public')).toBeEnabled())
  fireEvent.click(screen.getByText('Enregistrer le brouillon'))
  await screen.findByText('Rechargez le brouillon.')
  expect(screen.getByText('Enregistrer le brouillon')).toBeDisabled()
})
it('Caissier sans éditeur ni appel réseau',()=>{
  render(panel('cashier'))
  expect(screen.getByText('Module réservé au Gérant.')).toBeInTheDocument()
  expect(visibilityRequest).not.toHaveBeenCalled()
})
it('changement de compte démonte le formulaire et ignore la réponse ancienne',async()=>{
  let resolve:(v:null)=>void=()=>{}
  vi.mocked(visibilityRequest).mockReturnValueOnce(new Promise(r=>{resolve=r}))
  const view=render(panel());fireEvent.click(screen.getByText('Charger / recharger le brouillon'))
  view.rerender(<AuthContext.Provider value={{currentUser:{...user,id:'another',tenantId:'tenant-b'}} as AuthContextValue}><VisibilityPage/></AuthContext.Provider>)
  resolve(null)
  await waitFor(()=>expect(screen.getByLabelText('Nom public')).toBeDisabled())
})

it('charge et modifie les détails sans renvoyer les identifiants SQL dans le body',async()=>{
  const details={...emptyProfileDetails(),slogan:'Slogan existant',publicAddress:'Adresse de recette'}
  const draft={id:'profile',tenantId:'tenant-a',displayName:'Profil',description:'',city:'Abidjan',commune:'',publicPhone:null,version:3,details}
  vi.mocked(visibilityRequest).mockResolvedValueOnce(draft).mockResolvedValueOnce({...draft,version:4,details:{...details,slogan:'Nouveau slogan'}})
  render(panel());fireEvent.click(screen.getByText('Charger / recharger le brouillon'))
  await waitFor(()=>expect(screen.getByLabelText('Slogan')).toHaveValue('Slogan existant'))
  fireEvent.change(screen.getByLabelText('Slogan'),{target:{value:'Nouveau slogan'}})
  fireEvent.click(screen.getByText('Enregistrer le brouillon'))
  await screen.findByText('Brouillon enregistré sur le serveur. Aucune publication effectuée.')
  const command=vi.mocked(visibilityRequest).mock.calls[1][2]
  expect(command).toMatchObject({expectedVersion:3,details:{slogan:'Nouveau slogan',publicAddress:'Adresse de recette'}})
  expect(command).not.toHaveProperty('id');expect(command).not.toHaveProperty('tenantId')
})
