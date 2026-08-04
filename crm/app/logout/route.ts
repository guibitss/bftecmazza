import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Encerra a sessão e volta pro login.
 *
 * Existe pra quebrar o loop de redirect: o cookie do Supabase vale por HOST
 * (localhost serve produção e demo em portas diferentes), e auth.users é
 * compartilhado entre os schemas. Então dava pra ter sessão válida sem perfil
 * no schema atual — o layout mandava pro /login, o middleware via o cookie e
 * mandava de volta pra /, infinitamente. Limpar a sessão resolve na origem.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  return NextResponse.redirect(url);
}
