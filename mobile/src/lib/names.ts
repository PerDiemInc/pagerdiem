// People's names the way the screens say them.
import type { Person } from '@/lib/api';

export const firstName = (person: Person) => person.name.split(' ')[0];

/** "Ana", "Eli and Fay", "Ana, Eli and Fay" */
export const joinWords = (words: string[]) =>
  words.length < 2 ? words.join('') : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;

/** First names, with you first as "You": "You and Ana". */
export const namesWithYou = (people: Person[], meId: number) =>
  joinWords([...people].sort((a, b) => Number(b.id === meId) - Number(a.id === meId)).map((p) => (p.id === meId ? 'You' : firstName(p))));

const SOURCES: Record<string, [tag: string, inSentence: string]> = {
  slack: ['Slack', 'Slack'], web: ['Web', 'the web'], app: ['App', 'the app'], api: ['API', 'the API'],
};
/** "Slack", "Web", or an alert source like "Coralogix" */
export const sourceName = (source: string) => SOURCES[source]?.[0] ?? source.charAt(0).toUpperCase() + source.slice(1);
/** "from Slack", "from the web" */
export const fromSource = (source: string) => `from ${SOURCES[source]?.[1] ?? sourceName(source)}`;
