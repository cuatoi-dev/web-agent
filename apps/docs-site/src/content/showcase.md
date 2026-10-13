---
title: Beer CSS Interactive Showcase
---

# Beer CSS Interactive Showcase

This page demonstrates the full Beer CSS UI kit. Each control has a clear accessible name so the agent can click, fill, select, and toggle elements by label.

---

## Buttons

<section class="card medium-elevate padding">
<h5>Button Variants</h5>

<button class="filled">Save</button>
<button class="tonal">Submit</button>
<button class="border">Cancel</button>
<button class="flat">Reset</button>
<button class="circle" aria-label="Add item"><i>add</i></button>
<button class="filled" disabled>Delete</button>

</section>

---

## Text Inputs

<section class="card medium-elevate padding">
<h5>Input Fields</h5>

<div class="field label border">
  <input type="text" id="full-name" />
  <label for="full-name">Full name</label>
</div>

<div class="field label prefix border">
  <i>search</i>
  <input type="text" id="search-input" />
  <label for="search-input">Search</label>
</div>

<div class="field label border">
  <input type="email" id="email-input" />
  <label for="email-input">Email</label>
</div>

</section>

---

## Textarea

<section class="card medium-elevate padding">
<h5>Textarea</h5>

<div class="field label textarea border">
  <textarea id="message-textarea"></textarea>
  <label for="message-textarea">Message</label>
</div>

</section>

---

## Checkboxes

<section class="card medium-elevate padding">
<h5>Checkboxes</h5>

<label class="checkbox">
  <input type="checkbox" checked />
  <span>Subscribe to newsletter</span>
</label>

<label class="checkbox">
  <input type="checkbox" />
  <span>Accept terms</span>
</label>

<label class="checkbox">
  <input type="checkbox" />
  <span>Receive updates</span>
</label>

</section>

---

## Switches

<section class="card medium-elevate padding">
<h5>Switches</h5>

<label class="switch">
  <input type="checkbox" />
  <span></span>
  Dark mode
</label>

<label class="switch">
  <input type="checkbox" checked />
  <span></span>
  Notifications
</label>

</section>

---

## Radio Buttons

<section class="card medium-elevate padding">
<h5>Plan Selection</h5>

<label class="radio">
  <input type="radio" name="plan" value="free" checked />
  <span>Free</span>
</label>

<label class="radio">
  <input type="radio" name="plan" value="pro" />
  <span>Pro</span>
</label>

<label class="radio">
  <input type="radio" name="plan" value="enterprise" />
  <span>Enterprise</span>
</label>

</section>

---

## Select

<section class="card medium-elevate padding">
<h5>Select Field</h5>

<div class="field label suffix border">
  <select id="country-select">
    <option value="">Choose…</option>
    <option value="us">United States</option>
    <option value="uk">United Kingdom</option>
    <option value="de">Germany</option>
    <option value="vn">Vietnam</option>
  </select>
  <label for="country-select">Country</label>
  <i>arrow_drop_down</i>
</div>

</section>

---

## Slider

<section class="card medium-elevate padding">
<h5>Slider Controls</h5>

<label for="volume-slider">Volume</label>
<label class="slider">
  <input type="range" id="volume-slider" min="0" max="100" value="50" />
  <span></span>
</label>

</section>

---

## Chips

<section class="card medium-elevate padding">
<h5>Filter Chips</h5>

<div class="row">
  <a class="chip active">Design</a>
  <a class="chip">Code</a>
  <a class="chip">Docs</a>
  <a class="chip">Testing</a>
</div>

</section>

---

## Tabs

<section class="card medium-elevate padding">
<h5>Tab Navigation</h5>

<div class="tabs">
  <a data-ui="#tab-overview" class="active">Overview</a>
  <a data-ui="#tab-details">Details</a>
  <a data-ui="#tab-settings">Settings</a>
</div>

<div class="page active" id="tab-overview">
  <p>This is the <strong>Overview</strong> tab content.</p>
</div>
<div class="page" id="tab-details">
  <p>This is the <strong>Details</strong> tab content.</p>
</div>
<div class="page" id="tab-settings">
  <p>This is the <strong>Settings</strong> tab content.</p>
</div>

</section>

---

## Menu

<section class="card medium-elevate padding">
<h5>Dropdown Menu</h5>

<button data-ui="#menu1">Options</button>
<menu id="menu1">
  <a class="row">Edit</a>
  <a class="row">Duplicate</a>
  <a class="row">Archive</a>
  <hr />
  <a class="row">Delete</a>
</menu>

</section>

---

## Dialog

<section class="card medium-elevate padding">
<h5>Dialog / Modal</h5>

<button data-ui="#dlg1">Open dialog</button>

<dialog id="dlg1">
  <h5>Confirm action</h5>
  <p>Are you sure you want to proceed with this action?</p>
  <nav class="right-align">
    <button class="border" data-ui="#dlg1">Cancel</button>
    <button class="filled" data-ui="#dlg1">Confirm</button>
  </nav>
</dialog>

</section>

---

## Snackbar

<section class="card medium-elevate padding">
<h5>Snackbar Notification</h5>

<button data-ui="#snack1">Show snackbar</button>

<div class="snackbar" id="snack1">
  <span>Changes saved successfully.</span>
  <button class="flat" data-ui="#snack1">Dismiss</button>
</div>

</section>

---

## Lists

<section class="card medium-elevate padding">
<h5>List Items</h5>

<ul>
  <li>First list item</li>
  <li>Second list item</li>
  <li>Third list item</li>
</ul>

<nav>
  <a class="row">
    <i>inbox</i>
    <span class="max">Inbox</span>
    <span class="badge">3</span>
  </a>
  <a class="row">
    <i>send</i>
    <span class="max">Sent</span>
  </a>
  <a class="row">
    <i>delete</i>
    <span class="max">Trash</span>
  </a>
</nav>

</section>

---

## Table

<section class="card medium-elevate padding">
<h5>Data Table</h5>

<table>
  <thead>
    <tr>
      <th>Name</th>
      <th>Role</th>
      <th>Status</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Alice</td>
      <td>Admin</td>
      <td>Active</td>
    </tr>
    <tr>
      <td>Bob</td>
      <td>Editor</td>
      <td>Inactive</td>
    </tr>
    <tr>
      <td>Carol</td>
      <td>Viewer</td>
      <td>Active</td>
    </tr>
  </tbody>
</table>

</section>

---

## Cards

<section class="padding">
<h5>Card Variants</h5>

<div class="card">
  <h6>Default Card</h6>
  <p>A standard card with default elevation.</p>
  <nav class="right-align">
    <button class="flat">Learn more</button>
  </nav>
</div>

<div class="card border">
  <h6>Outlined Card</h6>
  <p>A card with a border outline and no elevation.</p>
  <nav class="right-align">
    <button class="border">View details</button>
    <button class="filled">Get started</button>
  </nav>
</div>

</section>

---

## Expansions

<section class="card medium-elevate padding">
<h5>Expandable Sections</h5>

<details>
  <summary>Show details</summary>
  <p>This content is revealed when the summary is clicked. Useful for FAQs or progressive disclosure.</p>
</details>

<details>
  <summary>Advanced options</summary>
  <p>Additional configuration options appear here.</p>
</details>

</section>

---

## Tooltip

<section class="card medium-elevate padding">
<h5>Tooltip</h5>

<span>
  Hover over this element
  <div class="tooltip">This is a helpful tooltip message.</div>
</span>

</section>

---

## Badges

<section class="card medium-elevate padding">
<h5>Badge Indicators</h5>

<div class="row">
  <button class="flat">
    Notifications
    <div class="badge">5</div>
  </button>

  <button class="flat">
    Messages
    <div class="badge">12</div>
  </button>
</div>

</section>

---

## Progress

<section class="card medium-elevate padding">
<h5>Progress Indicators</h5>

<label>Indeterminate progress</label>
<progress></progress>

<label>Determinate progress (75%)</label>
<progress value="75" max="100"></progress>

</section>
