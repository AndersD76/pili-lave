import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";

const PREF_KEY = "pililave_biometria_ativa";

/** O aparelho tem sensor E já cadastrou digital/rosto? Sem isso não tem o que oferecer. */
export async function biometriaDisponivel(): Promise<boolean> {
  const [temSensor, temCadastro] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ]);
  return temSensor && temCadastro;
}

export async function biometriaAtiva(): Promise<boolean> {
  return (await SecureStore.getItemAsync(PREF_KEY)) === "1";
}

export async function setBiometriaAtiva(ativa: boolean): Promise<void> {
  if (ativa) await SecureStore.setItemAsync(PREF_KEY, "1");
  else await SecureStore.deleteItemAsync(PREF_KEY);
}

/** Pede a digital/rosto. true = liberou, false = cancelou ou falhou. */
export async function autenticarComBiometria(): Promise<boolean> {
  const r = await LocalAuthentication.authenticateAsync({
    promptMessage: "Entrar no PILI LAVE",
    cancelLabel: "Cancelar",
    disableDeviceFallback: false, // sem digital cadastrada, cai na senha/PIN do aparelho
  });
  return r.success;
}
