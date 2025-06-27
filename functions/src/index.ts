import nodemailer from "nodemailer";
import * as admin from "firebase-admin";
import * as functions from "firebase-functions";
import {onSchedule} from "firebase-functions/scheduler";

admin.initializeApp();
const db = admin.firestore();

interface GameData {
    id: string;
    title: string;
    description: string;
    imageUrl: string | null;
    url: string;
    startDate: string;
    endDate: string;
}

function getGameData(game: any): GameData | null {
    const promo = game.promotions?.promotionalOffers?.[0]?.promotionalOffers?.[0];
    if (!promo) return null;

    const now = new Date();
    const start = new Date(promo.startDate);
    const end = new Date(promo.endDate);
    if (now < start || now > end) return null;

    const productSlug = game.productSlug;
    const pageSlug = game.offerMappings?.[0]?.pageSlug;

    let gameUrl = "";
    if (productSlug) {
        gameUrl = `https://store.epicgames.com/p/${productSlug}`;
    } else if (pageSlug) {
        gameUrl = `https://store.epicgames.com/p/${pageSlug}`;
    }

    const imageUrl =
        game.keyImages?.find((img: any) => img.type === "OfferImageWide")?.url ??
        game.keyImages?.[0]?.url ??
        null;

    return {
        id: game.id,
        title: game.title,
        description: game.description ?? "",
        imageUrl,
        url: gameUrl,
        startDate: promo.startDate,
        endDate: promo.endDate,
    };
}

async function returnNewGames(): Promise<GameData[]> {
    const response = await fetch(
        "https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=US&allowCountries=US"
    );
    if (!response.ok) throw new Error("Epic API error");

    const games = (await response.json())?.data?.Catalog?.searchStore?.elements ?? [];
    const gamesRef = db.collection("games");
    const newGames: GameData[] = [];

    for (const game of games) {
        const gameData = getGameData(game);
        if (!gameData) continue;

        const gameId = `${gameData.title}-${gameData.startDate}`;
        const existing = await gamesRef.doc(gameId).get();
        if (existing.exists) continue;

        await gamesRef.doc(gameId).set(gameData);
        newGames.push(gameData);
    }
    return newGames;
}

async function sendMail(games: GameData[]) {
    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
            user: process.env.GOOGLE_USER_MAIL,
            pass: process.env.GOOGLE_USER_PASS,
        },
    });

    const htmlContent = `
    <h2>Yeni Ücretsiz Epic Games Oyunları</h2>
    <ul>
      ${games
        .map(
            (g) => `
          <li>
            <strong>${g.title}</strong><br/>
            ${g.imageUrl ? `<img alt="${g.title}" src="${g.imageUrl}" width="300" /><br/>` : ""}
            <a href="${g.url}" target="_blank">Oyunu Görüntüle</a><br/>
            <small>Ücretsiz: ${g.startDate.slice(0, 10)} - ${g.endDate.slice(0, 10)}</small>
          </li>`
        )
        .join("")}
    </ul>
  `;

    await transporter.sendMail({
        from: `Epic Bot <${process.env.GOOGLE_USER_MAIL}>`,
        to: "alierend.sevinc@gmail.com",
        subject: "🎮 Yeni Ücretsiz Epic Games Oyunları!",
        html: htmlContent,
    });
}

export const fetchGamesNow = functions.https.onRequest(async (req, res) => {
    try {
        const newGames = await returnNewGames();
        res.status(200).send(`${newGames.length} free games fetched and stored.`);
    } catch (err) {
        console.error("Error fetching games:", err);
        res.status(500).send("Something went wrong.");
    }
});

export const fetchGamesAndSendMail = functions.https.onRequest(async (req, res) => {
    try {
        const newGames = await returnNewGames();
        if (newGames.length > 0) {
            await sendMail(newGames);
            res.status(200).send(`${newGames.length} free games fetched and stored. And Mail sent.`);
        } else {
            res.status(200).send(`No new games to send.`);
        }
    } catch (err) {
        console.error("Error:", err);
        res.status(500).send("Something went wrong.");
    }
});

export const scheduledFetchGames = onSchedule(
    {schedule: "every 24 hours", timeZone: "Europe/Istanbul"},
    async () => {
        try {
            const newGames = await returnNewGames();
            if (newGames.length > 0) {
                await sendMail(newGames);
                console.log(`${newGames.length} free games fetched and stored. And Mail sent.`);
            } else {
                console.log(`No new games to send.`);
            }
        } catch (err) {
            console.error("Scheduled job error:", err);
        }
    }
);
