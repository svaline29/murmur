export type Agent = {
  x: number;
  y: number;
  vx: number;
  vy: number;
};

export type RuleWeights = {
  separation: number;
  alignment: number;
  cohesion: number;
  speed: number;
  perception: number;
};
