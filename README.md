# Meliva spetsialistiprofiilide platvorm

Arstide ja spetsialistide veebiprofiilide kogumine, AI-korrastus ja -tõlge, arsti kinnitus ning turunduse töölaud käsitsi avaldamiseks. **Rakendus ei avalda midagi automaatselt ega ühendu meliva.ee-ga.**

## Tehniline lahendus

| Osa | Lahendus |
|---|---|
| Rakendus | Next.js 15 (App Router) + TypeScript, üks Renderi Web Service |
| Andmebaas | Render PostgreSQL, Prisma migratsioonid (`prisma/migrations`), käivitusel `prisma migrate deploy` |
| Failid | Fotod (originaal, töödeldud ja professionaalsed versioonid) on Postgresis (`PhotoVersion.data`). **CV-faile ei säilitata**: hoitakse ainult väljaloetud tekst ja faktid koos päritoluga |
| Taustatööd | Püsiv järjekord Postgresis (`Job`): `FOR UPDATE SKIP LOCKED`, piiratud korduskatsed, `dedupeKey`, aegunud luku korral jätkamine. Töötleja jookseb veebiprotsessis ning seda käivitatakse ka päringute ajal (Free-plaan) |
| Tekst, tõlge, OCR | Anthropic Claude (`ANTHROPIC_MODEL`, vaikimisi `claude-sonnet-5-5`), tool-use JSON + zod-valideerimine + faktivalvur |
| Foto | sharp (taust, valgus, toon, kadreering, mõõdud, EXIF eemaldus) + Replicate'i tausta eemaldus. Gemini pildimudel **ainult** siis, kui arst valib tööriietuse muutmise |
| E-post | Integratsiooni pole (manuaalne režiim). Süsteem koostab kirja ja koodi, haldur saadab selle oma postkastist ja märgib saadetuks |
| Arsti autentimine | E-post + 6-kohaline kood. Kood on HMAC-räsina, kehtib 30 päeva, on mitmekordne ja tühistatav. 5 vale katset lukustab koodi, lisaks on IP ja e-posti päringupiirangud. httpOnly sessiooniküpsis, URL-is tokenit pole |
| Halduri autentimine | E-post + parool (argon2) + kohustuslik TOTP 2FA, rollid ADMIN/MANAGER, kõik kontrollid serveris |

### Andmevood ja teenusepakkujad
- **Anthropic (Claude):** profiili tekst, vabatekst, CV tekst või skann (OCR), foto (näo nähtavuse kontroll). Halduse e-posti AI-le ei saadeta.
- **Replicate:** originaalfoto tausta eemaldamiseks.
- **Google Gemini:** originaalfoto, ainult tööriietuse muutmise valikul.
- **Render:** rakendus ja andmebaas. Piirkond valitakse Renderi teenuse loomisel; ELi jaoks vali **Frankfurt**.
- Võtme puudumisel kuvatakse „Teenus seadistamata“. Mock-teenused on lubatud ainult `APP_MODE=test` korral ja need on selgelt märgistatud („TESTREŽIIM“).

## Juurutamine Renderisse

1. Render → New → PostgreSQL (piirkond Frankfurt). Kopeeri **Internal Database URL**.
2. Render → New → Web Service sellest GitHubi repost, haru `main`, samas piirkonnas.
   - Build: `npm install && npm run build`
   - Start: `npm start` (käivitab `prisma migrate deploy` ja `next start` pordil `$PORT`)
3. Environment (vt `.env.example`):
   - `DATABASE_URL` – andmebaasi Internal URL
   - `SESSION_SECRET` – vähemalt 32 juhuslikku märki
   - `APP_URL` – teenuse aadress, nt `https://xxx.onrender.com` (läheb kutsekirja)
   - `APP_MODE=production`
   - `ANTHROPIC_API_KEY`, `REPLICATE_API_TOKEN`, `GEMINI_API_KEY`
   - `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD` (vt allpool)
4. Iga push harusse `main` juurutab rakenduse uuesti. Andmed ja fotod on Postgresis, seega säilivad need taaskäivituste ja uute juurutuste järel.

> **Free-plaan:** sobib ainult testimiseks väljamõeldud testisikutega. Free Postgres aegub 30 päeva pärast ja kustutatakse, ning Free veebiteenus jääb 15 minuti jõudeoleku järel magama (taustatööd jätkuvad järgmise päringuga). **Enne päris arstide andmeid tuleb üle minna tasulisele plaanile** (Starter web + Basic Postgres) ja lülitada sisse varundus.

## Esimene administraator

### Renderis seadistamine ja esimene sisselogimine

1. Ava Renderis rakenduse **Web Service → Environment** ning lisa:
   - `BOOTSTRAP_ADMIN_EMAIL` – administraatori e-posti aadress, millega sisse logid.
   - `BOOTSTRAP_ADMIN_PASSWORD` – ajutine algparool (vähemalt 12 märki).
2. Salvesta muutujad ja oota, kuni teenus on käivitunud. Käivitamisel loob rakendus selle e-postiga administraatori ainult siis, kui andmebaasis pole veel ühtegi kasutajat.
3. Ava brauseris `https://<sinu-teenuse-aadress>/haldus/login` (näiteks `https://xxx.onrender.com/haldus/login`). Sisesta `BOOTSTRAP_ADMIN_EMAIL` ja `BOOTSTRAP_ADMIN_PASSWORD`, seejärel vajuta **Logi sisse**. Esimesel korral jäta autentimisrakenduse koodi väli tühjaks.
4. Avaneb **Seadista kaheastmeline autentimine** leht. Paigalda telefoni autentimisrakendus, näiteks Google Authenticator või Microsoft Authenticator. Skanni lehel olev QR-kood, sisesta rakenduses kuvatav kood väljale **Kood** ja vajuta **Kinnita**. Hoia QR-kood ja selle all näidatud salavõti privaatsena.
5. Pärast kinnitamist avaneb haldusvaade. Kontrolli, et saad välja logida ja uuesti sisse logida: edaspidi sisesta sisselogimisel lisaks e-postile ja paroolile ka autentimisrakenduse värske kood.
6. Kui sisselogimine ja 2FA on kontrollitud, eemalda Renderi keskkonnamuutujatest `BOOTSTRAP_ADMIN_PASSWORD` ning salvesta muudatus. Andmebaasis olev administraator ja parool jäävad alles; algparooli muutujat on vaja ainult konto esmakordseks loomiseks.

Kui administraatorit ei looda, kontrolli, et teenus oleks pärast muutujate lisamist käivitunud, e-post ja parool oleksid õiged ning andmebaasis poleks juba ühtegi kasutajat. Kui kasutaja on juba olemas, lisa järgmised haldurid haldusvaates **Seaded → Haldurid** kaudu.

**Alternatiiv käsurealt:** sea `DATABASE_URL` väärtuseks Renderi andmebaasi External URL ja käivita `npm run create-admin -- admin@meliva.ee "Nimi"`. See käsk loob või uuendab administraatori ning väljastab genereeritud ajutise parooli, kui `ADMIN_PASSWORD` pole määratud. Seejärel logi sisse ülaltoodud sammudega.

## Kohalik arendus (valikuline)

Projekti reegel on, et kohalikku andmebaasi ega serverit ei looda. Kui seda siiski vaja on: Node 20+, `npm install`, `.env` (vt `.env.example`), `npx prisma migrate deploy`, `npm run dev`. Testkeskkonnas sea `APP_MODE=test`. Kasuta ainult väljamõeldud testisikuid.

## Testid

`npm test` (Vitest) katab koodide aegumise, tühistamise ja lukustamise, teise arsti ressursi keelamise, impordi vastuolud ilma ülekirjutamiseta, AI skeemi ja faktivalvuri puuduvate või lisatud faktidega, valikuliste jaotiste ja täielikkuse, tõlgete aegumise, käsitsi tõlke säilimise, kinnitusega seotud keele- ja fotoversiooni, muutumatu koopia, turunduse sisulise ja vormistusliku muudatuse eristamise, kopeeritava teksti ja HTML-i puhtuse, allkirjastatud allalaadimislingi, tööde dubleerimise vältimise ning selle, et e-posti saatmist pole.

## Varundamine ja taastamine

- **Tasulisel Renderi Postgresil** on igapäevased automaatsed varukoopiad ja point-in-time recovery (Dashboard → Database → Recovery).
- **Käsitsi varukoopia:** `pg_dump --format=custom "$EXTERNAL_DATABASE_URL" > meliva-$(date +%F).dump`. Hoia see krüpteeritud ja piiratud ligipääsuga kohas, sest see sisaldab fotosid ja isikuandmeid.
- **Taastamine:** `pg_restore --clean --no-owner -d "$EXTERNAL_DATABASE_URL" meliva-YYYY-MM-DD.dump`
- **Arhiveerimine:** spetsialisti detailvaates märgi „Arhiveeritud“. Kustutamisel (`DELETE FROM "Specialist" WHERE id=…`) kaovad kaskaadina ka fotod, versioonid ja logid. Tee seda ainult halduri säilitamisotsuse alusel.

## Halduri lühijuhend

1. **+ Uus spetsialist:** nimi, kontrollitud e-post (mitte nime põhjal tuletatud), rühm.
2. **Kutse:** spetsialisti lehel vali „Loo kutse“, kontrolli adressaati, vali „Kopeeri kiri“ (või „Ava e-posti programmis“), saada kiri ja vali seejärel „Märgi saadetuks“. Kood on nähtav ainult loomise hetkel. Uue koodi loomine tühistab vana.
3. **Arst** logib aadressil `/` sisse e-posti ja koodiga, täidab sammud 1–7 ning kinnitab sisu.
4. **Ülevaatus:** järjekord „Turunduse ülevaatust ootavad“ → avaldamistöölaud. Seal saad tagastada arstile põhjusega, parandada teksti (sisuline parandus saadab profiili arstile uuesti kinnitamiseks) või märkida profiili valmis.
5. **Avaldamine:** kopeeri iga keel lihttekstina või HTML-ina tervikuna või jaotiste kaupa, laadi alla kinnitatud foto, lisa sisu käsitsi meliva.ee-sse ja märgi versioon koos URL-idega avaldatuks.
6. **Ülevaatuse meeldetuletus:** nupp „Loo ülevaatuse meeldetuletuse ülesanded“ loob ülesanded neile, kelle viimane kinnitus on vanem kui seadistatud tähtaeg (vaikimisi 12 kuud). Seejärel saada „Vaata profiil üle“ kutse. Arst saab kinnitada „Info on endiselt õige“.

## Seis

**Teostatud ja automaattestidega kontrollitud:** äriloogika, mida kirjeldab jaotis „Testid“. `npm run build` õnnestub.

**Teostatud, kuid päris keskkonnas veel kontrollimata:** kogu põhiteekond brauseris Renderis (andmebaas, migratsioon ning arsti ja halduri vaated desktopis ja mobiilis), Claude'i, Replicate'i ja Gemini päris väljundid ning mõõdetud töötlusajad.

**Vajab välist seadistust:** Renderi andmebaas ja keskkonnamuutujad, API-võtmed, tasuline plaan ja varundus enne päris andmeid.

**Pole tehtud (teadlik otsus):** e-posti integratsioon ja automaatsed meeldetuletuskirjad, avaliku veebi kontroll ja meliva.ee-st eeltäitmine (veebikataloog, CSV-võrdlusnimekiri, SSRF-kaitsega lugemine) ning monitooringuteenus (praegu on struktureeritud JSON-logid Renderi logides).

**Kinnitamist vajavad äriotsused:**
- Kas AI-teenuste kasutamine (USA pakkujad) on Meliva andmekaitsenõuetega kooskõlas ja kas on vaja ELi-põhist töötlust või DPA-sid?
- Kinnituse sõnastus.
- Fotostiil: vaatlesin ainult ühte referentsfotot. Referentsfotol on stetoskoop, platvorm seda ei lisa.
- Ülevaatustähtaeg ja kohustuslikud väljad spetsialistirühmade kaupa.
- Originaalfotode ja logide säilitamisaeg.
