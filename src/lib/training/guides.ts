/**
 * How each movement in movements.ts is done, for the Library: a short
 * description of the movement itself, then the one or two cues that matter
 * most. Plain guidance for someone who already trains, not coaching.
 */
export interface Guide {
  /** The movement start to finish, in a few sentences. */
  how: string
  /** What to watch for. */
  cues: string[]
}

export const GUIDES: Record<string, Guide> = {
  // --- Cardio ---
  'bike-cal': {
    how: 'Ride the bike for the calories on its display. Set resistance so you can hold a steady, hard cadence rather than spinning out or grinding.',
    cues: ['Pace it: the first calories are the easy ones to overspend.', 'Stay seated unless the WOD says to sprint.'],
  },
  'row-cal': {
    how: 'Row for the calories on the monitor. Each stroke goes legs, then hips swing back, then arms pull the handle to the bottom of the ribs; the return reverses it: arms, hips, then knees.',
    cues: ['Most of the power comes from the legs pushing, not the arms pulling.', 'Damper around 4-6 suits most people.'],
  },
  run: {
    how: 'Run the distance at a pace you can hold for the whole WOD, not a sprint.',
    cues: ['Short, quick steps landing under the hips.', 'Breathe through the nose on the way out if you can; you\'ll need the rest later.'],
  },
  'single-under': {
    how: 'Jump rope with one turn of the rope per jump. Small hops, a couple of centimetres off the floor, on the balls of the feet.',
    cues: ['Turn the rope from the wrists, elbows close to the sides.', 'If you trip, start again straight away rather than resetting.'],
  },
  'double-under': {
    how: 'The rope passes under the feet twice in one jump. Jump a little higher than for singles, legs straight, and snap the wrists faster as you leave the floor.',
    cues: ['Stay tall: no piking or kicking the heels back.', 'Scale to three single-unders for each double.'],
  },
  'jumping-jack': {
    how: 'Jump the feet out wide as the arms swing up overhead, then jump back to feet together, arms at the sides.',
    cues: ['Land softly on the balls of the feet.'],
  },
  burpee: {
    how: 'From standing, put the hands down, jump or step the feet back to a plank, lower the chest to the floor, push back up, jump or step the feet in, then stand and jump with a clap overhead.',
    cues: ['Step instead of jumping to keep it low impact.', 'Find a rhythm you can keep for every rep.'],
  },
  'box-jump': {
    how: 'Stand facing the box, dip and swing the arms, jump onto it landing with both feet flat, then stand all the way up at the top. Step down.',
    cues: ['Stepping down saves the Achilles; rebounding off the floor doesn\'t.', 'Land softly with the knees out.'],
  },

  // --- Barbell ---
  deadlift: {
    how: 'Feet hip-width, bar over the middle of the feet. Hinge and grip just outside the legs, chest up and back flat, then push the floor away and stand up with the bar dragging up the legs. Lower it the same way.',
    cues: ['Brace before each rep and keep the bar touching you.', 'Hips and shoulders rise together.'],
  },
  'front-squat': {
    how: 'Bar across the front of the shoulders, elbows high, fingertips under the bar. Sit down between the heels to below parallel, then stand up driving the elbows up.',
    cues: ['Elbows up keeps the chest up and the bar on the shoulders.', 'Knees track out over the toes.'],
  },
  'back-squat': {
    how: 'Bar across the upper back, hands just outside the shoulders. Brace, sit down and back to below parallel, then stand up through the whole foot.',
    cues: ['Chest proud and back tight the whole way.', 'Push the knees out on the way down and up.'],
  },
  thruster: {
    how: 'A front squat straight into a press. From the front rack, squat to below parallel, then stand up fast and use that drive to press the bar overhead to locked arms. Lower it back to the shoulders as you go into the next squat.',
    cues: ['The legs throw the bar; the arms only finish it.', 'Keep the elbows up in the squat.'],
  },
  'push-press': {
    how: 'From the front rack, dip a few inches by bending the knees (torso upright), drive up hard through the legs, and press the bar overhead to locked arms as it leaves the shoulders.',
    cues: ['Straight dip, straight drive: don\'t let the chest fall forward.', 'Head through at the top, bar over the middle of the feet.'],
  },
  'strict-press': {
    how: 'From the front rack, press the bar overhead to locked arms with no help from the legs. Move the head back out of the way, then through once the bar passes it.',
    cues: ['Squeeze the glutes and brace so the back doesn\'t arch.', 'Grip just outside the shoulders.'],
  },
  'push-jerk': {
    how: 'Dip and drive as for a push press, but push yourself under the bar into a partial squat, catching it on locked arms, then stand up.',
    cues: ['Fast feet: drive up, then punch down under the bar.', 'Lock the arms as you land, not after.'],
  },
  'hang-power-clean': {
    how: 'Stand with the bar at the hips. Hinge until the bar is just above the knees, then jump: extend the hips hard, shrug, and pull yourself under the bar, catching it in the front rack in a partial squat. Stand up.',
    cues: ['Hips first, arms last: the arms just guide the bar.', 'Fast elbows round to the front rack.'],
  },
  'power-clean': {
    how: 'A clean from the floor. Lift the bar off the floor as for a deadlift, and as it passes the knees, extend the hips explosively and pull under to catch it in the front rack in a partial squat.',
    cues: ['Slow off the floor, fast above the knees.', 'Keep the bar close all the way up.'],
  },
  'hang-power-snatch': {
    how: 'Wide grip, bar at the hips. Hinge to just above the knees, then extend the hips explosively and pull the bar up close to the body, punching under to catch it overhead on locked arms in a partial squat. Stand up.',
    cues: ['Bar close to the body, as if zipping a jacket.', 'Lock out hard overhead the instant it lands.'],
  },
  'overhead-squat': {
    how: 'Bar locked out overhead with a wide grip. Squat to below parallel keeping the bar over the middle of the feet, then stand up.',
    cues: ['Push up into the bar and squeeze the shoulder blades.', 'Go light: it\'s mobility as much as strength.'],
  },
  sdhp: {
    how: 'Feet wide, hands inside the legs close together. Deadlift the bar, and as the hips extend, shrug and pull the bar up to just under the chin, elbows high and outside. Lower it under control.',
    cues: ['Hips do the work; the arms finish the pull.', 'Elbows higher than the hands at the top.'],
  },
  'barbell-row': {
    how: 'Hinge forward to about 45 degrees with a flat back, bar hanging at arm\'s length. Pull it to the lower ribs, squeezing the shoulder blades, then lower it under control.',
    cues: ['Keep the torso still: no heaving.', 'Lead with the elbows.'],
  },
  'barbell-lunge': {
    how: 'Bar across the upper back as for a back squat. Step one foot back and lower until the back knee nearly touches the floor, then drive through the front foot to stand. Alternate legs.',
    cues: ['Torso upright and front knee over the foot.', 'Take it out of the rack and step back into it carefully.'],
  },
  'ground-to-overhead': {
    how: 'Get the bar from the floor to locked out overhead by any method (clean and press or jerk, or a snatch), then lower it back to the floor under control. No dropping.',
    cues: ['Pick the method you can repeat most efficiently.', 'Lower to the shoulders, then the hips, then the floor.'],
  },

  // --- Dumbbells ---
  'db-thruster': {
    how: 'A dumbbell in each hand at the shoulders. Squat to below parallel, then stand up fast and press both dumbbells overhead to locked arms in one movement. Bring them back to the shoulders into the next squat.',
    cues: ['Elbows up a little so the bells stay on the shoulders.', 'Let the legs throw the weight.'],
  },
  'db-push-press': {
    how: 'Dumbbells at the shoulders. Dip a few inches at the knees, drive up hard through the legs, and press the bells overhead to locked arms.',
    cues: ['Torso stays upright in the dip.', 'Finish with the biceps by the ears.'],
  },
  'db-strict-press': {
    how: 'Dumbbells at the shoulders, palms facing in or forward. Press them overhead to locked arms without using the legs, then lower under control.',
    cues: ['Brace and squeeze the glutes so the back doesn\'t arch.'],
  },
  'db-snatch': {
    how: 'One dumbbell on the floor between the feet. Hinge and grab it, then drive up through the hips and pull it straight up close to the body, punching it overhead to a locked arm in one movement. Lower it and switch hands each rep.',
    cues: ['Hips do the work; the arm only guides it.', 'Bring it down to the shoulder, then the floor.'],
  },
  'db-hang-clean': {
    how: 'A dumbbell in each hand at the sides. Hinge so they hang by the knees, then extend the hips hard and pull the bells up, rotating under to catch them on the shoulders in a partial squat. Stand up.',
    cues: ['Jump, then catch: the arms don\'t curl it.', 'Soft knees in the catch.'],
  },
  'db-clean-jerk': {
    how: 'Clean the dumbbells from the hang to the shoulders, then dip and drive to send them overhead, catching them on locked arms. Lower to the shoulders, then the hips.',
    cues: ['Two parts: finish the clean before the jerk.'],
  },
  'db-deadlift': {
    how: 'A dumbbell in each hand at the sides or in front of the thighs. Hinge, push the hips back and lower the bells to mid-shin with a flat back, then stand up by driving the hips forward.',
    cues: ['Weight in the heels; bells close to the legs.'],
  },
  'db-rdl': {
    how: 'Dumbbells in front of the thighs, knees soft. Push the hips back and slide the bells down the legs until you feel the hamstrings stretch (around the knees or just below), then drive the hips forward to stand.',
    cues: ['Knees stay nearly straight; the hips move, not the knees.', 'Back flat, never rounded.'],
  },
  'goblet-squat': {
    how: 'Hold one dumbbell vertically at the chest by its top end (or one in each hand at the shoulders). Squat down between the heels to below parallel, elbows inside the knees, then stand up.',
    cues: ['Chest up; the weight in front helps you sit upright.'],
  },
  'db-overhead-squat': {
    how: 'One dumbbell locked out overhead in one hand. Squat to below parallel keeping the arm vertical and the bell over the middle of the foot, then stand. Split the reps between arms.',
    cues: ['Eyes on a point ahead, arm locked and pushing up.', 'Go light until it\'s steady.'],
  },
  'db-reverse-lunge': {
    how: 'A dumbbell in each hand at the sides. Step one foot back and lower until the back knee nearly touches the floor, then drive through the front foot to stand. Alternate legs.',
    cues: ['Upright torso, front shin close to vertical.'],
  },
  'db-walking-lunge': {
    how: 'A dumbbell in each hand at the sides. Step forward into a lunge, back knee nearly touching the floor, then bring the back foot through into the next step.',
    cues: ['Long enough steps that the front knee stays over the foot.'],
  },
  'db-step-up': {
    how: 'A dumbbell in each hand. Put one whole foot on the box and stand up on it, then step back down. Alternate legs.',
    cues: ['Push through the top foot, not off the bottom one.'],
  },
  'db-row': {
    how: 'Hinge forward with a flat back, a dumbbell in each hand at arm\'s length. Pull them to the lower ribs, squeezing the shoulder blades, then lower under control.',
    cues: ['Keep the torso still and the neck in line.'],
  },
  'renegade-row': {
    how: 'In a plank with hands on two dumbbells, feet wide. Row one dumbbell to the ribs keeping the hips square, put it down, then row the other. One row each side is two reps.',
    cues: ['Wider feet make it steadier.', 'Don\'t let the hips twist.'],
  },
  'db-floor-press': {
    how: 'Lie on the floor, knees bent, a dumbbell in each hand above the chest. Lower until the upper arms touch the floor, pause, then press back to locked arms.',
    cues: ['Elbows about 45 degrees from the body.'],
  },
  'db-high-pull': {
    how: 'A dumbbell in each hand, or one held in both hands. Hinge, then extend the hips hard and pull the weight up to chest height, elbows high and outside. Lower it under control.',
    cues: ['Hips first; the arms finish.'],
  },
  'db-swing': {
    how: 'Hold one dumbbell by an end in both hands. Hike it back between the legs, then snap the hips forward to swing it up to eye height (or overhead for an American swing). Let it fall back into the next hinge.',
    cues: ['A hinge, not a squat: it\'s all hips.', 'Arms are just ropes.'],
  },
  'devil-press': {
    how: 'Hands on two dumbbells on the floor. Do a burpee with the chest down between them, then jump the feet in and swing both bells from the floor to overhead in one movement, as in a double snatch. Lower and repeat.',
    cues: ['Swing them through the legs; don\'t curl them.', 'Go lighter than you think.'],
  },
  'man-maker': {
    how: 'Hands on two dumbbells in a plank: a push-up, a row with each arm, then jump the feet in, clean the bells to the shoulders and thruster them overhead. That\'s one rep.',
    cues: ['Steady and complete rather than fast.'],
  },

  // --- Kettlebells ---
  'kb-swing': {
    how: 'Hike the kettlebell back between the legs, then snap the hips forward to swing it up to eye height (or overhead for an American swing). Let it fall back into the next hinge.',
    cues: ['All hips: squeeze the glutes at the top.', 'Arms relaxed, like ropes.'],
  },
  'kb-goblet-squat': {
    how: 'Hold the kettlebell by the horns at the chest. Squat down between the heels to below parallel, elbows inside the knees, then stand up.',
    cues: ['Chest up and heels down.'],
  },

  // --- Gymnastics ---
  'pull-up': {
    how: 'Hang from the bar with straight arms. Pull until the chin is over the bar, then lower back to straight arms. Strict, or kipping once you have strict ones.',
    cues: ['Start each rep from a full hang.', 'Pull the elbows down toward the hips.'],
  },
  'banded-pull-up': {
    how: 'A pull-up with a band looped over the bar and under one foot or knee for help. Same full range: straight arms to chin over the bar.',
    cues: ['Pick the lightest band that lets you do the reps in a few sets.'],
  },
  'chest-to-bar': {
    how: 'A pull-up that goes high enough for the chest to touch the bar, just below the collarbone.',
    cues: ['Lean back slightly and pull the bar to you.'],
  },
  'toes-to-bar': {
    how: 'Hang from the bar and raise the feet until the toes touch it between the hands, then lower them under control.',
    cues: ['Push down on the bar with straight arms to lift the hips.', 'Scale to hanging knee raises.'],
  },
  'knees-to-chest': {
    how: 'Hang from the bar and raise the knees up toward the chest, higher than the hips, then lower them under control.',
    cues: ['No swinging: control the way down.'],
  },
  'ring-row': {
    how: 'Hold the rings with straight arms, leaning back with the body in a straight line, heels on the floor. Pull the chest to the rings, then lower.',
    cues: ['Walk the feet forward to make it harder, back to make it easier.', 'Squeeze the shoulder blades at the top.'],
  },
  'ring-dip': {
    how: 'Support yourself on the rings with straight arms. Lower until the shoulders are below the elbows, then press back to locked arms.',
    cues: ['Rings turned out at the top, close to the body.', 'Scale with a band or the feet on the floor.'],
  },

  // --- Bodyweight ---
  'push-up': {
    how: 'In a plank, hands just wider than the shoulders. Lower the chest to the floor, then push back up to straight arms, body in one line.',
    cues: ['Elbows at about 45 degrees, not flared.', 'Scale with the hands on a bench or the knees down.'],
  },
  'hand-release-push-up': {
    how: 'A push-up where the chest goes all the way to the floor and the hands lift off it for a moment before pushing back up.',
    cues: ['Keep the body rigid as you push off the floor.'],
  },
  'pike-push-up': {
    how: 'Hands and feet on the floor, hips high in an upside-down V. Bend the elbows to lower the top of the head toward the floor between the hands, then press back up.',
    cues: ['Feet on a step makes it harder.'],
  },
  'air-squat': {
    how: 'Feet shoulder-width. Sit down and back until the hips are below the knees, then stand all the way up.',
    cues: ['Heels down, knees out, chest up.'],
  },
  'reverse-lunge': {
    how: 'Step one foot back and lower until the back knee nearly touches the floor, then drive through the front foot to stand. Alternate legs.',
    cues: ['Torso upright.'],
  },
  'glute-bridge': {
    how: 'Lie on the back, knees bent, feet flat. Push through the heels to lift the hips until the body is straight from shoulders to knees, squeeze, then lower.',
    cues: ['Squeeze the glutes at the top; don\'t arch the lower back.'],
  },
  'sit-up': {
    how: 'Lie back over the ab mat, soles of the feet together and knees out. Swing the arms overhead to the floor, then sit up and touch the floor in front of the feet.',
    cues: ['The ab mat supports the lower back and gives the full range.'],
  },
  'v-up': {
    how: 'Lie flat, arms overhead. Lift the legs and torso together, reaching the hands to the feet so the body makes a V, then lower both under control.',
    cues: ['Legs straight; bend the knees to scale (tuck-ups).'],
  },
  'hollow-rock': {
    how: 'In a hollow hold (lower back pressed down, arms and legs off the floor), rock back and forth from shoulders to hips, keeping the shape.',
    cues: ['If the shape breaks, bring the arms and knees in.'],
  },
  'hollow-hold': {
    how: 'Lie on the back, press the lower back into the floor, and lift the shoulders, arms and straight legs a few inches off it. Hold.',
    cues: ['Lower back stays on the floor; tuck the knees to scale.'],
  },
  plank: {
    how: 'Forearms on the floor under the shoulders, body straight from head to heels. Hold.',
    cues: ['Squeeze the glutes and brace; don\'t let the hips sag.'],
  },
  superman: {
    how: 'Lie face down, arms overhead. Lift the arms, chest and legs off the floor together, hold for a moment, then lower. Each lift is a rep.',
    cues: ['Look at the floor to keep the neck neutral.'],
  },
  'mountain-climber': {
    how: 'In a plank on the hands, drive one knee toward the chest, then switch legs quickly, as if running in place. Each knee is a rep.',
    cues: ['Shoulders over the hands; hips level.'],
  },
}
