import { createLesson, ensureCourse } from './actions';

const SAMPLES: Record<string, { title: string; text: string }> = {
  es: {
    title: 'Un día en Madrid',
    text: `Me llamo Lucía y vivo en Madrid. Todas las mañanas me levanto a las siete y tomo un café con leche en el bar de la esquina.

El camarero se llama Pedro. Siempre me pregunta cómo estoy y me cuenta las noticias del barrio. Por lo tanto, siempre llego al trabajo con una sonrisa.

Trabajo en una pequeña librería cerca del parque del Retiro. Me encantan los libros, sobre todo las novelas de misterio. Por la tarde, cuando hace buen tiempo, doy un paseo por el parque con mi perro, Toby.

Los fines de semana quedo con mis amigos para comer tapas. A veces vamos al cine o a un concierto. Madrid es una ciudad llena de vida, y no me imagino viviendo en otro lugar.`,
  },
  fr: {
    title: 'Une journée à Paris',
    text: `Je m'appelle Camille et j'habite à Paris. Chaque matin, je prends un croissant et un café dans la petite boulangerie au coin de ma rue.

Ensuite, je prends le métro pour aller au travail. Je travaille dans un musée près de la Seine. J'adore mon travail parce que je rencontre des gens du monde entier.

Le soir, je me promène le long du fleuve avec mes amis. Nous parlons de tout et de rien, et parfois nous dînons dans un petit restaurant.`,
  },
  de: {
    title: 'Ein Tag in Berlin',
    text: `Ich heiße Jonas und wohne in Berlin. Jeden Morgen fahre ich mit dem Fahrrad zur Arbeit. Der Weg führt durch einen schönen Park.

Ich arbeite in einem kleinen Café in Kreuzberg. Viele Gäste kommen jeden Tag, und ich kenne die meisten schon beim Namen.

Am Wochenende treffe ich mich mit Freunden. Wir gehen ins Museum, ins Kino oder einfach spazieren. Berlin ist eine Stadt, in der es immer etwas Neues zu entdecken gibt.`,
  },
  it: {
    title: 'Una giornata a Roma',
    text: `Mi chiamo Marco e vivo a Roma. Ogni mattina faccio colazione al bar con un cappuccino e un cornetto.

Lavoro in un ufficio vicino al Colosseo. A pranzo mangio spesso una pizza con i miei colleghi.

La sera mi piace passeggiare per il centro storico. Roma è bellissima di notte, e ogni strada racconta una storia.`,
  },
  pt: {
    title: 'Um dia em Lisboa',
    text: `Chamo-me Ana e moro em Lisboa. Todas as manhãs tomo um café e como um pastel de nata na pastelaria perto de casa.

Depois apanho o elétrico para ir trabalhar. Trabalho numa escola, onde ensino história às crianças.

Ao fim da tarde, gosto de ver o pôr do sol no miradouro com os meus amigos.`,
  },
};

export async function seedSample(lang: string) {
  const s = SAMPLES[lang];
  if (!s) return;
  const courseId = await ensureCourse(lang, 'Getting started');
  await createLesson({ lang, title: s.title, text: s.text, courseId });
}
