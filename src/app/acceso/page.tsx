import { redirect } from "next/navigation";
import LoginGestion from "@/components/LoginGestion";
import { getGoogleEmail, rutaSegura } from "@/lib/google-oauth";

export const metadata = {
  title: "Acceso | Centralización Adquisiciones",
};

// Depende de la cookie de sesión, así que nunca se sirve prerenderizada.
export const dynamic = "force-dynamic";

export default async function AccesoPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { volver } = await searchParams;
  // Con sesión ya iniciada no tiene sentido esta pantalla.
  if (await getGoogleEmail()) {
    redirect(rutaSegura(Array.isArray(volver) ? volver[0] : volver));
  }
  return (
    <div className="py-8">
      <LoginGestion />
    </div>
  );
}
